const fs     = require ('fs');
const parser = require ('csv-parse');
const Decimal= require ('decimal.js');
Decimal.set({ precision: 50 });
Decimal.set({ rounding: 8 });

// global functions
var csv_loader = function(file,callback){
  fs.readFile(__dirname+'/'+file,'utf8',function(err,contents){
    if(err) {
      console.log(err);
      callback(err);
    }
    else {
      parser(contents,function(err,data){
        if(err) {
          console.log(err);
          callback(err);
        }
        var headers = data[0];
        var list = [];
        for(var i=1; i<data.length; i+=1){
          var struct = {};
          for(var j=0; j<headers.length; j+=1){
            struct[headers[j]] = data[i][j];
          }
          list.push(struct);
        }
        callback(null,list);
      });
    }
  });
}

var write_csv = function(csv,callback){
  fs.writeFile('public-audit.csv',csv,function(err){
    if(err) {
      console.log("An error occurred while writing the file: "+err);
      callback(err);
    } else {
      console.log("Your file was written to the current directory as public-audit.csv");
      callback(null,true);
    }
  });
}

// format cash contributions
var format_cash = function(arr){
  var final = [];
  var date_unix = new Date(CASH_CLOSE).getTime();
  for(var i=0; i<arr.length; i+=1) {
    var temp = {};
    temp['unix-epoch'] = date_unix;
    temp['timestamp'] = CASH_CLOSE;
    temp['txid'] = 'partner';
    temp['type'] = 'usd';
    temp['ethereum_payout_address'] = (arr[i].length>1)?arr[i][1]:null;
    temp['btc_value'] = arr[i][0] / END_BTC_PRICE;
    temp['btc'] = temp['btc_value'];
    temp['%'] = null;
    temp['dragons'] = null;
    temp['exception'] = null;
    temp['type_of_exception'] = null;
    temp['convert_rate'] = END_BTC_PRICE;
    final.push(temp);
  }
  return final;
}

var presale_loader = function(arr){
  var final = [];
  var date_unix = new Date(PRESALE_DATE).getTime();
  for(var i=0; i<arr.length; i+=1) {
    var temp = {};
    temp['unix-epoch'] = date_unix;
    temp['timestamp'] = PRESALE_DATE;
    temp['amount'] = arr[i].amount;
    temp['txid'] = null;
    temp['type'] = arr[i].type;
    temp[arr[i].type] = arr[i].amount;
    temp['convert_rate'] = (temp['type']=='btc')?1:presale_close_ethbtc;
    temp['ethereum_payout_address'] = null;
    temp['btc_value'] = (arr[i].type == 'btc')?arr[i].amount.toString():new Decimal(arr[i].amount).mul(presale_close_ethbtc).toString();
    temp['%'] = null;
    temp['dragons'] = null;
    temp['exception'] = null;
    temp['type_of_exception'] = null;
    final.push(temp);
  }
  return final;
}

// convert_rate is optional
var convert_ethereum = function(data,bittrex_hourly,convert_rate_input=null){
  var final_array = [];
  for(var i=0; i<data.length; i+=1){
    var temp = data[i];
    if(convert_rate_input){
      temp['btc_value'] = Decimal.mul(temp['eth'],convert_rate_input).toString();
    } else {
      // convert amount and return
      var timestamp = new Date(parseInt(temp['unix-epoch']));
      timestamp = new Date(timestamp).setHours(new Date(timestamp).getHours() + 1);
      timestamp = new Date(timestamp).setMinutes(0);
      timestamp = new Date(timestamp).setSeconds(0);
      timestamp = new Date(timestamp).toISOString();
      // lookup conversion and insert
      var convert_rate = bittrex_hourly[timestamp.split('.')[0]];
      temp['amount_btc'] = Decimal.mul(temp['amount'], convert_rate).toString();
      temp['convert_rate'] = convert_rate;
    }
    final_array.push(temp);
  }
  return final_array;
}

// arr1 = split1, arr2 = split2
var apply_splits = function(idx,arr,txid,splits){
  var origin_transaction = arr[idx];
  var type = origin_transaction['type'];
  var origin_percent = new Decimal(origin_transaction['%']).div(100).toString();
  var total = new Decimal(0);
  var total_temp_percent = new Decimal(0);
  var filtered = null;
  var final = [];
  var split_out = splits[txid];

  // filters out the splits that only deal with either bitcoin or ethereum
  if(type=='eth') {
    filtered = split_out.filter(eth_filter);
    //convert
    filtered = convert_ethereum(filtered,null,origin_transaction['convert_rate']);
  }
  else filtered = split_out.filter(btc_filter);

  // calculate the total bitcoin value for the split array
  for(var i=0; i<filtered.length; i+=1){
    if(type=='eth') total = total.plus(filtered[i]['btc_value']);
    else total = total.plus(filtered[i]['btc']);
  }
  for(var i=0; i<filtered.length; i+=1){
    var temp = {};
    temp['exception'] = origin_transaction['exception'];
    temp['exception_type'] = origin_transaction['exception_type'];
    temp[type] = filtered[i][type];
    temp['timestamp'] = origin_transaction['timestamp'];
    temp['unix-epoch'] = origin_transaction['unix-epoch'];
    temp['txid'] = origin_transaction['txid'];
    temp['type'] = origin_transaction['type'];
    temp['ethereum_payout_address'] = (filtered[i]['ethereum_payout_address'])?filtered[i]['ethereum_payout_address']:null;
    temp['convert_rate'] = origin_transaction['convert_rate'];
    temp['btc_value'] = (type=='eth')?filtered[i]['btc_value']:filtered[i]['btc'];
    // find percentage of current transaction against total_btc_value
    var temp_percent = new Decimal(temp['btc_value']).div(total);
    temp['%'] = temp_percent.mul(origin_percent).mul(100).toString();
    temp['dragons'] = Decimal.mul(temp_percent,origin_transaction['dragons']).toPrecision(18).toString();
    total_temp_percent  = total_temp_percent.plus(temp_percent);
    final.push(temp);
  }
  return final;
}

var handle_hardware_swap = function(audit,swaps){
  var final = [];
  for(var i=0; i<audit.length; i+=1){
    var temp = audit[i];
    if(swaps.hasOwnProperty(temp['ethereum_payout_address']) && temp['exception'] != "yes"){
      temp['ethereum_payout_address'] = swaps[temp['ethereum_payout_address']];
    }
    final.push(temp);
  }
  return final;
}

var eth_filter = function(x){ return x['eth']>0; }
var btc_filter = function(x){ return x['btc']>0; }

var sort_unix = function(a,b){return a['unix-epoch'] - b['unix-epoch'];}

// global variables
const START_DATE = "10/02/2017 08:00:00 AM"; //in PDT
// the final block time from transactions submitted before 5 PM PDT
const END_DATE = "11/02/2017 05:11:30 PM"; //in PDT
const PRESALE_DATE = "08/22/2017 06:00:00 PM"; // in PDT
const CASH_CLOSE = "11/02/2017 04:59:59 PM";
const END_BTC_PRICE = 6979.51; // close BTC price for November 2, 2017 at 5:00:00 PM PDT
const public_dragons= 238421940.35;

const audit_exceptions_file = "audit-exceptions.csv";

// contributions from partners during the sale and the associated DRGN receiving addresses
var cash_contributions = [
  [100000,'0xcDbEeb1029411e8D59CED42Ed3e2142B930647B9'],
  [10000,'0x5cb51ba463dd559996b36121Cec1F087EeEd2397'],
  [10000,'0xB0F5d7BA0E425c1Ff406F4f0946E4680562837F4'],
  [10000,'0x37756183530e7871F067acDaaD1a780A6514241a'],
  [5000,'0xe7c2ae32Ab822e79E658981d51b7A4c4eC80222B'],
  [4040,'0xb3b7aC365fbb97E67F30074A042423C9A04e0451'],
  [530,'0x3ff7E67B452bCa45E009328022bC1B84bB8ce7CD']];

var presale_contributions = [{type: 'btc',amount: 157.25},{type: 'eth',amount: 2357.53}]; // results from the presale
var presale_close_ethbtc  = 0.076320; // close conversion rate for August 22, 2017 at 6:00:00 PM PDT

module.exports.csv_loader       = csv_loader;
module.exports.write_csv        = write_csv;
module.exports.sort_unix        = sort_unix;
module.exports.format_cash      = format_cash;
module.exports.presale_load     = presale_loader;
module.exports.apply_splits     = apply_splits;
module.exports.convert_ethereum = convert_ethereum;
module.exports.handle_hw_swaps  = handle_hardware_swap;
module.exports.start_date       = START_DATE;
module.exports.end_date         = END_DATE;
module.exports.presale_date     = PRESALE_DATE;
module.exports.end_btc_price    = END_BTC_PRICE;
module.exports.audit_excp       = audit_exceptions_file;
module.exports.cash_contr       = cash_contributions;
module.exports.presale_contr    = presale_contributions;
module.exports.presale_close    = presale_close_ethbtc;
module.exports.public_drgns     = public_dragons;
module.exports.cash_close       = CASH_CLOSE;
