// const rp = require ('request-promise');
// const R  = require ('ramda');
// const fs = require ('fs');
var   Decimal = require('decimal.js');
var   json2csv= require('json2csv');
// Decimal.set({ precision: 50 });
// Decimal.set({ rounding: 8 });
// const csvParser = require ('csv-parse');
// const request = require ('request');
// const ETH_URL = require ('../global_exports').eth_url;
// const ADDR_MAP_URL = require ('../global_exports').ico_addr_map;
// const START_DATE = require ('../global_exports').start_date;
// const END_DATE = require ('../global_exports').end_date;
// const dateformat = require ('dateformat');
// const json2csv = require ('json2csv');
const async   = require ('async');
// const ETH_API_KEY     = process.env.ETH_API_KEY || null;
// const ETH_CONVERT     = require('../global_exports').eth_conversion;
// const eth_ref_addr = require ('../global_exports').referral_addr;
// const audit_exceptions_file = require ('../global_exports').audit_file;
// const BTC_CONVERT = require ('../global_exports').btc_conversion;
// const BTC_URL = require ('../global_exports').btc_url;
// const END_BTC_PRICE = require ('../global_exports').end_btc_price;
// const cash_contributions = require ('../global_exports').cash_contrib;
// const presale_contributions = require ('../global_exports').presale_cont;
// const presale_date = require ('../global_exports').presale_date;
// const presale_close = require ('../global_exports').presale_close;
// const util    = require ('util');
// // var   mc = require ('../mem-client');
// const START_BLOCK     = 4330703;
// const END_BLOCK       = 99999999;
// const public_dragons = 238421940;
var   bittrex_hourly = {}; // converting eth-btc at hourly
var   redeem_addresses = {};
// var   graph_lookup = "%s-transaction-graph";
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


var init = function(){
  // loads the csv files
  async.parallel([
    function(callback){
      csv_loader('csv/bittrex-hourly.csv',callback);
    },
    function(callback){
      csv_loader('csv/btc-transactions.csv',callback);
    },
    function(callback){
      csv_loader('csv/eth-transactions.csv',callback);
    },
    function(callback){
      csv_loader('csv/bitcoin-addresses.csv',callback);
    },
    function(callback){
      csv_loader('csv/audit-exceptions.csv',callback);
    }
  ], function(err, results){
    var bittrex_results  = results[0];
    var btc_transactions = results[1];
    var eth_transactions = results[2];
    var btc_address_map  = results[3];
    var audit_exc        = results[4];

    // load bitcoin address to ethereum redeem address linkings
    for(var i=0; i<btc_address_map.length; i+=1){
      if(btc_address_map[i][0]) redeem_addresses[btc_address_map[i][0]] = btc_address_map[i][1];
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
    temp['ethereum_payout_address'] = (type=='btc')?redeem_addresses[arr[i].address]:arr[i].from;
    temp['btc_value'] = (type=='btc')?arr[i].amount:arr[i]['amount_btc'];
    temp['btc'] = (type=='btc')?arr[i].amount:0;
    temp['eth'] = (type=='eth')?arr[i].amount:0;
    temp['%'] = null;
    temp['dragons'] = null;
    temp['exception'] = null;
    temp['type_of_exception'] = null;
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

// var get_transactions = function(callback) {
//   get_address_mapping(function(err,result){
//     if(result){
//       get_hourly_bittrex();
//       async.series([
//         function (callback) {
//           var key = util.format(graph_lookup, 'btc');
//           get_memcache(key, callback);
//         }
//       ], function (err, results) {
//         if (err) console.log(err);
//         else {
//           ethereum_query(function(err,result){
//             if(result){
//               console.log('calculating results');
//               var eth_array = result;
//               var btc_array = unpack_structure(results[0]);
//               var presale = presale_loader(presale_contributions);
//               eth_array = convert_ethereum(eth_array);
//               eth_array = format_table('eth',eth_array);
//               btc_array = format_table('btc',btc_array);
//               var btc_cash_value = format_cash(cash_contributions);
//               var combined = eth_array.concat(btc_array);
//               combined = combined.concat(btc_cash_value);
//               combined = combined.concat(presale);
//               combined = combined.sort(sort_json);
//               combined = calculate_total_btc(combined);
//               var stringified = stringify_json(combined);
//               var paginated_results = R.splitEvery(1000,stringified);
//               var joined_page = join_array(paginated_results);
//               joined_page = add_index('audit_',joined_page);
//               async.each(joined_page,insert_memcache,function(err){
//                 if(err) console.log(err);
//                 else {
//                   var fields = [{label:'Timestamp (PDT)',value:'timestamp'},{label:'Unix-Epoch (UTC)',value:'unix-epoch'},'txid','type','ethereum_payout_address','convert_rate','btc_value','btc','eth','%','dragons','exception','type_of_exception'];
//                   var opts = {
//                     data: combined,
//                     fields: fields,
//                     defaultValue: 0
//                   }
//                   var csv = json2csv(opts)
//                   callback(null,csv);
//                 }
//               });
//             } else {
//               callback(err);
//             }
//           });
//         }
//       });
//     }
//   });
// }

init();