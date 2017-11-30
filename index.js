var   Decimal = require('decimal.js');
var   json2csv= require('json2csv');
const async   = require ('async');
Decimal.set({ precision: 50 });
Decimal.set({ rounding: 8 });
var   bittrex_hourly = {}; // converting eth-btc at hourly
var   redeem_addresses = {};
var   splits = {};
var   hw_swaps = {};
var   exceptions    = [];
var   csv_loader       = require ('./global_variables').csv_loader;
var   write_csv        = require ('./global_variables').write_csv;
var   sort_unix        = require ('./global_variables').sort_unix;
var   format_cash      = require ('./global_variables').format_cash;
var   presale_loader   = require ('./global_variables').presale_load;
var   apply_splits     = require ('./global_variables').apply_splits;
var   convert_ethereum = require ('./global_variables').convert_ethereum;
var   handle_hw_swaps  = require ('./global_variables').handle_hw_swaps;
var   cash_contr       = require ('./global_variables').cash_contr;
var   presale_con      = require ('./global_variables').presale_contr;
var   START_DATE       = require ('./global_variables').start_date;
var   END_DATE         = require ('./global_variables').end_date;
var   presale_date     = require ('./global_variables').presale_date;
var   public_dragons   = require ('./global_variables').public_drgns;

var init = function(base_folder){
  // loads the csv files
  async.parallel([
    function(callback){
      csv_loader(base_folder+'/bittrex-hourly.csv',callback);
    },
    function(callback){
      csv_loader(base_folder+'/btc-transactions.csv',callback);
    },
    function(callback){
      csv_loader(base_folder+'/eth-transactions.csv',callback);
    },
    function(callback){
      csv_loader(base_folder+'/bitcoin-addresses.csv',callback);
    },
    function(callback){
      csv_loader(base_folder+'/audit-exceptions.csv',callback);
    },
    function(callback){
      csv_loader(base_folder+'/split1.csv',callback);
    },
    function(callback){
      csv_loader(base_folder+'/split2.csv',callback);
    },
    function(callback){
      csv_loader(base_folder+'/hardwareswap.csv',callback);
    }
  ], function(err, results){
    var bittrex_results  = results[0];
    var btc_transactions = results[1];
    var eth_transactions = results[2];
    var btc_address_map  = results[3];
    var audit_exc        = results[4];
    var split_group_1    = results[5];
    var split_group_2    = results[6];
    var hardware_swap    = results[7];

    // load bitcoin address to ethereum redeem address linkings
    for(var i=0; i<btc_address_map.length; i+=1){
      if(btc_address_map[i]['BTC_ADDRESS']) redeem_addresses[btc_address_map[i]['BTC_ADDRESS']] = btc_address_map[i]['ETH_PAYOUT'];
    }

    // load audit exceptions
    for(var i=0; i<audit_exc.length; i+=1){
      var txid = audit_exc[i]['transaction_hash'];
      // handle if comma separated
      if(txid.indexOf(',') > -1){
        var split_id = txid.split(',');
        for(var j=0; j<split_id.length; j+=1){
          exceptions.push(split_id[j].trim());
        }
      } else {
        exceptions.push(txid.trim());
      }
    }

    // load hardware swap list
    for(var i=0; i<hardware_swap.length; i+=1){
      hw_swaps[hardware_swap[i]['Original']] = hardware_swap[i]['New'];
    }

    // load bittrex_hourly data
    for (var i = 0; i < bittrex_results.length; i += 1) {
      bittrex_hourly[bittrex_results[i]['Timestamp']] = bittrex_results[i]['Close'];
    }

    // load in split1
    var split1 = [];
    for(var i=0; i<split_group_1.length; i+=1){
      var temp = {};
      temp['ethereum_payout_address'] = split_group_1[i]['ethereum_payout_address'];
      temp['btc'] = (split_group_1[i]['BTC']!="")?split_group_1[i]['BTC']:0;
      temp['eth'] = (split_group_1[i]['ETH']!="")?split_group_1[i]['ETH']:0;
      split1.push(temp);
    }
    splits['0'] = split1;

    // load split2
    var split2 = [];
    // load baby-dragon-breeders
    for(var i=0; i<split_group_2.length; i+=1){
      var temp = {};
      temp['ethereum_payout_address'] = split_group_2[i]['ethereum_payout_address'];
      temp['eth'] = split_group_2[i]['ETH'];
      split2.push(temp);
    }
    splits['0x1328458772e4db52d14a6b106a7ce546e158098e4ca094c3f3ecd60042db32ec'] = split2;

    // convert the ethereum to bitcoin
    eth_transactions = convert_ethereum(eth_transactions,bittrex_hourly,null);
    // load all bitcoin transactions
    btc_transactions = format_table('btc',btc_transactions);
    // load all ethereum transactions
    eth_transactions = format_table('eth',eth_transactions);
    // load presale contributions
    var presale = presale_loader(presale_con);
    // load cash contributions
    var btc_cash_value = format_cash(cash_contr);

    // combine btc and ethereum transactions and
    var combined = eth_transactions
      .concat(btc_transactions)
      .concat(btc_cash_value)
      .concat(presale);

    // sort transactions in ascending order
    combined = combined.sort(sort_unix);
    // assigns percent contributed and number of dragons allotted
    combined = calculate_total_btc(combined);

    // apply splits
    // handle presale
    var presale1 = apply_splits(0,combined,0,splits);
    var presale2 = apply_splits(1,combined,0,splits);
    // load in splits
    combined.splice.apply(combined,[0,1].concat(presale1));
    combined.splice.apply(combined,[presale1.length,1].concat(presale2));

    var normal_split = null;
    var idx = null;
    // do 2nd split
    for(var i=0; i<combined.length; i+=1){
      if(combined[i]['txid'] == "0x1328458772e4db52d14a6b106a7ce546e158098e4ca094c3f3ecd60042db32ec"){
        normal_split = apply_splits(i,combined,combined[i]['txid'],splits);
        idx = i;
        break;
      }
    }

    // combine data sources
    combined.splice.apply(combined,[idx,1].concat(normal_split));

    // apply the hardware swaps=, changing eth payout address to hardware wallet address
    combined = handle_hw_swaps(combined,hw_swaps);

    // generate the csv
    var fields = [{label:'Timestamp (PDT)',value:'timestamp'},{label:'Unix-Epoch (UTC)',value:'unix-epoch'},'txid','type','ethereum_payout_address','convert_rate','btc_value','btc','eth','%','dragons','exception','exception_type'];
    var opts = {
      data: combined,
      fields: fields,
      defaultValue: 0
    }
    var csv = json2csv(opts)
    write_csv(csv,function(err,result){
      if(err) process.exit(1);
      else process.exit(0);
    });
  });
}

var format_table = function(type,arr){
  var final = [];
  for(var i=0; i<arr.length; i+=1){
    var temp = {};
    temp['unix-epoch'] = arr[i]['unix-epoch'];
    temp['timestamp'] = new Date(parseInt(temp['unix-epoch'])).toLocaleString();
    temp['txid'] = arr[i]['txid'];
    temp['type'] = (type=='btc')?'btc':'eth';
    temp['ethereum_payout_address'] = (type=='btc')?redeem_addresses[arr[i].to]:arr[i].from;
    temp['btc_value'] = (type=='btc')?arr[i].amount:arr[i]['amount_btc'];
    temp['btc'] = (type=='btc')?arr[i].amount:0;
    temp['eth'] = (type=='eth')?arr[i].amount:0;
    if(type=='btc') temp['convert_rate'] = 1;
    else temp['convert_rate'] = arr[i]['convert_rate'];
    final.push(temp);
  }
  return final;
}

var calculate_total_btc = function(arr){
  var total = new Decimal(0);
  var total_dragons = new Decimal(0);
  var start_convert = new Date(START_DATE).getTime();
  var end_convert   = new Date(END_DATE).getTime();
  var presale_con   = new Date(presale_date).getTime();
  var final = [];
  for(var i=0; i<arr.length; i+=1){
    var convert_ts = new Date(arr[i].timestamp).getTime();
    if(convert_ts>=start_convert && convert_ts<=end_convert || convert_ts == presale_con) {
      total = total.plus(arr[i].btc_value);
    }
  }
  // run through and insert percentage and dragons
  for(var i=0; i<arr.length; i+=1){
    var temp = arr[i];
    var convert_ts = new Date(temp.timestamp).getTime();
    if(convert_ts>=start_convert && convert_ts<=end_convert || convert_ts == presale_con) {
      var public_ratio = new Decimal(public_dragons).div(total);
      var percent = (new Decimal(temp['btc_value']).div(total));
      var btc_val = new Decimal(temp['btc_value']);
      temp['%'] = percent.mul(100).toString();
      temp['dragons'] = btc_val.mul(public_ratio).toDecimalPlaces(18).toString();
      if(exceptions.indexOf(temp['txid'])>-1) temp['exception'] = 'yes';
      else temp['exception'] = 'n/a';
      temp['exception_type'] = 'n/a';
      total_dragons = total_dragons.plus(btc_val.mul(public_ratio));
    } else if(convert_ts < start_convert && convert_ts != new Date(presale_date).getTime()){
      temp['exception'] = 'yes';
      temp['exception_type'] = 'public-early';
    } else if(convert_ts > end_convert){
      temp['exception'] = 'yes';
      temp['exception_type'] = 'public-late';
    }
    final.push(temp);
  }
  return final;
}

if(process.argv.length < 3){
  console.log('no csv file specified');
  process.exit(1);
}

init(process.argv[2]);