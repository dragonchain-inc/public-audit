var   Decimal = require('decimal.js');
var   json2csv= require('json2csv');
const async   = require ('async');
var   bittrex_hourly = {}; // converting eth-btc at hourly
var   redeem_addresses = {};
var   exceptions    = [];
var   csv_loader    = require ('./global_variables').csv_loader;
var   write_csv     = require ('./global_variables').write_csv;
var   sort_unix     = require ('./global_variables').sort_unix;
var   format_cash   = require ('./global_variables').format_cash;
var   presale_loader= require ('./global_variables').presale_load;
var   cash_contr    = require ('./global_variables').cash_contr;
var   presale_con   = require ('./global_variables').presale_contr;
var   START_DATE    = require ('./global_variables').start_date;
var   END_DATE      = require ('./global_variables').end_date;
var   presale_date  = require ('./global_variables').presale_date;
var   public_dragons= require ('./global_variables').public_drgns;

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
    }
  ], function(err, results){
    var bittrex_results  = results[0];
    var btc_transactions = results[1];
    var eth_transactions = results[2];
    var btc_address_map  = results[3];
    var audit_exc        = results[4];

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

    // load bittrex_hourly data
    for (var i = 0; i < bittrex_results.length; i += 1) {
      var split_date = bittrex_results[i]['Timestamp'].split('T')[0].split('-');
      var split_time = bittrex_results[i]['Timestamp'].split('T')[1].split(':')[0];
      split_date = [split_date[1], split_date[2], split_date[0]];
      var date = split_date.join('/');
      if (!bittrex_hourly.hasOwnProperty(date)) bittrex_hourly[date] = {};
      bittrex_hourly[date][split_time] = bittrex_results[i];
    }
    // convert the ethereum to bitcoin
    eth_transactions = convert_ethereum(eth_transactions);
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

    // generate the csv
    var fields = [{label:'Timestamp (PDT)',value:'timestamp'},{label:'Unix-Epoch (UTC)',value:'unix-epoch'},'txid','type','ethereum_payout_address','convert_rate','btc_value','btc','eth','%','dragons','exception','type_of_exception'];
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

var convert_ethereum = function(data){
  var final_array = [];
  for(var i=0; i<data.length; i+=1){
    var temp = data[i];
    // convert amount and return
    var timestamp = temp.timestamp;
    var date = timestamp.split(' ')[0];
    var hour = timestamp.split(' ')[1].split(':')[0];
    // lookup conversion and insert
    var convert_rate = bittrex_hourly[date][hour]['Close'];
    temp['amount_btc'] = Decimal.mul(temp['amount'],convert_rate).toString();
    temp['convert_rate'] = convert_rate;
    final_array.push(temp);
  }
  return final_array;
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
      temp['type_of_exception'] = 'n/a';
      total_dragons = total_dragons.plus(btc_val.mul(public_ratio));
    } else if(convert_ts < start_convert && convert_ts != new Date(presale_date).getTime()){
      temp['exception'] = 'yes';
      temp['type_of_exception'] = 'public-early';
    } else if(convert_ts > end_convert){
      temp['exception'] = 'yes';
      temp['type_of_exception'] = 'public-late';
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