const fs     = require ('fs');
const parser = require ('csv-parse');
const Decimal= require ('decimal.js');

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
    temp['convert_rate'] = presale_close_ethbtc;
    temp['ethereum_payout_address'] = null;
    temp['btc_value'] = (arr[i].type == 'btc')?arr[i].amount:new Decimal(arr[i].amount).mul(presale_close_ethbtc).toString();
    temp['%'] = null;
    temp['dragons'] = null;
    temp['exception'] = null;
    temp['type_of_exception'] = null;
    final.push(temp);
  }
  return final;
}

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

// contributions from partners during the sale
var cash_contributions = [[25000],[114570],[10000],[5000],[4040],[10000,'0xd683676D376b136C7b169f530Fb06239FbF8544e'],
  [10000,'0xB0F5d7BA0E425c1Ff406F4f0946E4680562837F4'],
  [500,'0x3ff7E67B452bCa45E009328022bC1B84bB8ce7CD'],
  [530,'0x3ff7E67B452bCa45E009328022bC1B84bB8ce7CD'],
  [500,'0xF3EF427D03316E4240f95d566292FA265bbE81A8']];

var presale_contributions = [{type: 'btc',amount: 152.25},{type: 'eth',amount: 2357.53}]; // results from the presale
var presale_close_ethbtc  = 0.076320; // close conversion rate for August 22, 2017 at 6:00:00 PM PDT

module.exports.csv_loader   = csv_loader;
module.exports.write_csv    = write_csv;
module.exports.sort_unix    = sort_unix;
module.exports.format_cash  = format_cash;
module.exports.presale_load = presale_loader;
module.exports.start_date   = START_DATE;
module.exports.end_date     = END_DATE;
module.exports.presale_date = PRESALE_DATE;
module.exports.end_btc_price= END_BTC_PRICE;
module.exports.audit_excp   = audit_exceptions_file;
module.exports.cash_contr   = cash_contributions;
module.exports.presale_contr= presale_contributions;
module.exports.presale_close= presale_close_ethbtc;
module.exports.public_drgns = public_dragons;
module.exports.cash_close   = CASH_CLOSE;
