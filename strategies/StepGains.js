// Step Gains
// This only works with this modded version of Gekko
// https://github.com/crypto49er/moddedgekko
//

const log = require('../core/log.js');
const config = require ('../core/util.js').getConfig();
const CandleBatcher = require('../core/candleBatcher');
const RSI = require('../strategies/indicators/RSI.js');

var strat = {};
var rsi5 = new RSI({ interval: 14 });
var rsi5History = [];
var asset = 0;
var currency = 0;
var currentPrice = 0;
var counter = 0;
var layeredBuyAmount = 0;
var layeredSellAmount = 0;
var highestRSI = 0;
var candle5 = {};
var rsiAbove70 = false;
var buyPrice = 0; // Get it from onTrade
var watchPrice = 0.0;
var lowestPrice = 0.0;
var sellPrice = 0.0;
var advised = false;



// Prepare everything our strat needs
strat.init = function() {
  // your code!
  this.name = 'RSI Layer Buy Sell';
  this.tradeInitiated = false;

    // since we're relying on batching 1 minute candles into 5 minute candles
  // lets throw if the settings are wrong
  if (config.tradingAdvisor.candleSize !== 1) {
    throw "This strategy must run with candleSize=1";
  }

  // create candle batchers for 5 minute candles
  this.batcher5 = new CandleBatcher(5);

  // supply callbacks for 5 minute candle function
  this.batcher5.on('candle', this.update5);


  // Add an indicator even though we won't be using it because
  // Gekko won't use historical data unless we define the indicator here
  this.addIndicator('rsi', 'RSI', { interval: this.settings.interval});
}

// What happens on every new candle?
strat.update = function(candle) {
  // your code!

    // write 1 minute candle to 5 minute batchers
    this.batcher5.write([candle]);
    this.batcher5.flush();

    // Send message that bot is still working after 24 hours (assuming minute candles)
    counter++;
    if (counter == 1440){
      log.remote(this.name, ' - Bot is still working.');
      counter = 0;
    }

    log.debug('candle time', candle.start.format());
    log.debug('candle close price:', candle.close);

    currentPrice = candle.close;
}

strat.update5 = function(candle) {
  rsi5.update(candle);

  candle5 = this.batcher5.calculatedCandles[0];

  // We only need to store RSI for 10 candles
  rsi5History.push(rsi5.result);
  if (rsi5History.length > 10) {
    rsi5History.shift();
  }

  highestRSI = 0;
  for (i=5;i<=rsi5History.length-1;i++){
    if(rsi5History[i] > highestRSI) {
      highestRSI = rsi5History[i];
    }
  }
  
  //Send price and RSI to console every 5 minutes
  //log.info('Price', currentPrice, 'SMA', sma5.result, 'RSI', rsi5.result.toFixed(2));
}

// Based on the newly calculated
// information, check if we should
// update or not.
strat.check = function(candle) {
  // your code!

  if(watchPrice == 0){
    watchPrice = candle.close * 0.98;
}
if(candle.close <= watchPrice){
    lowestPrice = candle.close;
}
if(candle.close > lowestPrice && !advised && !this.tradeInitiated){
    this.advice({
      direction: 'long',
      amount: 100,
    });
    log.debug('Buying at', candle.close);
    sellPrice = candle.close * 1.03;
    advised = true;
}
if(candle.close > sellPrice && watchPrice != 0 && lowestPrice != 0 && advised && !this.tradeInitiated){
    this.advice("short");
    log.debug('Selling at', candle.close);
    watchPrice = 0;
    lowestPrice = 0;
    buyPrice = 0;
    sellPrice = 0;
    advised = false;
}


}

// This is called when trader.js initiates a 
// trade. Perfect place to put a block so your
// strategy won't issue more trader orders
// until this trade is processed.
strat.onPendingTrade = function(pendingTrade) {
  this.tradeInitiated = true;

}


// This runs whenever a trade is completed
// as per information from the exchange.
// The trade object looks like this:
// {
//   id: [string identifying this unique trade],
//   adviceId: [number specifying the advice id this trade is based on],
//   action: [either "buy" or "sell"],
//   price: [number, average price that was sold at],
//   amount: [number, how much asset was trades (excluding "cost")],
//   cost: [number the amount in currency representing fee, slippage and other execution costs],
//   date: [moment object, exchange time trade completed at],
//   portfolio: [object containing amount in currency and asset],
//   balance: [number, total worth of portfolio],
//   feePercent: [the cost in fees],
//   effectivePrice: [executed price - fee percent, if effective price of buy is below that of sell you are ALWAYS in profit.]
// }
strat.onTrade = function(trade) {
  this.tradeInitiated = false;
  if (trade.action == 'buy'){
    buyPrice = trade.price;
  }

  
}

// Trades that didn't complete with a buy/sell
strat.onTerminatedTrades = function(terminatedTrades) {
  log.info('Trade failed. Reason:', terminatedTrades.reason);
  this.tradeInitiated = false;
}

// This runs whenever the portfolio changes
// including when Gekko starts up to talk to 
// the exhange to find out the portfolio balance.
// This is how the portfolio object looks like:
// {
//   currency: [number, portfolio amount of currency],
//   asset: [number, portfolio amount of asset],
// }
strat.onPortfolioChange = function(portfolio) {

  // Sell if we start out holding a bag
  // We determine this as currency and asset starts out
  // at 0 before we get the info from the exchange. 
  if (asset == 0 && currency == 0 && portfolio.asset > 0) {
    log.info('Starting with a sell as Gekko probably crashed after a buy')
    //this.advice('short');
  }

  asset = portfolio.asset;
  currency = portfolio.currency;

  // Divide buy in 4 only if we don't hold assets
  // If we are holding assets, it means we began the layer buy process
  // and dividing again is like buying 1/4th of 75% 
  if (asset == 0) {
    layeredBuyAmount = currency / 4;
  }

  if (currency < 0.01) {
    layeredSellAmount = asset / 2;
  }

}

// This reports the portfolio value as the price of the asset
// fluctuates. Reports every minute when you are hodling.
strat.onPortfolioValueChange = function(portfolioValue) {
  log.info('new portfolio value', portfolioValue.balance);
  log.info('Holding more than 10% of asset =', portfolioValue.hodling);
}

// Optional for executing code
// after completion of a backtest.
// This block will not execute in
// live use as a live gekko is
// never ending.
strat.end = function() {
  // your code!
}

// This runs when a commad is sent via Telegram
strat.onCommand = function(cmd) {
  var command = cmd.command;
  if (command == 'start') {
      cmd.handled = true;
      cmd.response = "Hi. I'm Gekko. Ready to accept commands. Type /help if you want to know more.";
  }
  if (command == 'status') {
      cmd.handled = true;
      cmd.response = config.watch.currency + "/" + config.watch.asset +
      "\nPrice: " + currentPrice;
      
  }
  if (command == 'help') {
  cmd.handled = true;
      cmd.response = "Supported commands: \n\n /buy - Buy at next candle" + 
      "\n /sell - Sell at next candle " + 
      "\n /status - Show indicators and current portfolio";
  }
  if (command == 'buy') {
    cmd.handled = true;
    this.advice('long');
  
  }
  if (command == 'sell') {
    cmd.handled = true;
    this.advice('short');
  }
}


module.exports = strat;