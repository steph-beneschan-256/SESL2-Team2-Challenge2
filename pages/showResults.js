import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import styles from '../styles/showResults.module.css';


/*
Create the ShowResults component, which shows the value of the user's assets over time.

Notes:
* As long as we are using the free plan for the Marketstack API, we can only retrieve stock data from the previous year. See:
https://marketstack.com/product

* Currently calculating a stock's value using the following formula:
(p2 - p1) * (i/p1) * 100%
Where:
  p1: price of the stock when the investment was initially made
  p2: current price of the stock
  i: amount of money initially invested into the stock

* I have elected to use Apexcharts to create the chart. Please let me know if this is an issue. See:
https://apexcharts.com/docs/react-charts/
*/

/* 
Import the Chart component from ApexCharts.
Evidently ApexCharts relies on the window API, so server-side rendering needs to be disabled.
Information sources:
- https://stackoverflow.com/a/68598070
- https://nextjs.org/docs/pages/building-your-application/optimizing/lazy-loading#with-no-ssr
*/
const Chart = dynamic(() => 
  import("react-apexcharts"),
  {ssr: false}
);

// Sample Data from the Marketstack API for stocks AAPL, GOOG, and MSFT
const sampleData = require('../marketstack-eod-sample-data.json');

// Sample portfolio data for testing purposes
const samplePortfolio = 
{
  initial: 32500.00,
  startDate: "2013-03-20T00:00:00.000Z",
  assets: [
    {
      symbol: "AAPL",
      portion: 0.20
    },
    {
      symbol: "GOOG",
      portion: 0.50
    },
    {
      symbol: "MSFT",
      portion: 0.30
    }
  ]
}

/*
Format a date to be supplied to the date_from and/or date_to arguments
of the Marketstack API's eod endpoint
*/
function marketstackDateString(date) {
  const y = date.getUTCFullYear().toString().padStart(4,'0');
  const m = date.getUTCMonth().toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/*
Fetch stock data from the Marketstack API
(To save on API calls, for now the function is configured to 
instead use the sample data from marketstack-eod-sample-data.json)
*/
async function getStockData(symbols, startDate) {
  const usingSampleData = true; // change this to use the actual API

  if(usingSampleData)
    return sampleData;

  const apiKey = require('../api-keys.json')["marketstack"];
  const requestURL = "http://api.marketstack.com/v1/eod"
  + new URLSearchParams({
    access_key: apiKey,
    symbols: symbols.join(','),
    date_from: marketstackDateString(new Date(startDate)),
    date_to: marketstackDateString(new Date()),
    sort: "ASC",
    limit: 1000
  });
  const marketstackResponse = await fetch(requestURL);
  //todo: handle error from api
  const jsonData = await marketstackResponse.json();
  return jsonData;
}

/*
Get a stock investment's value at a given time, based on its current
price, its price at the time of the investment, and the amount of
money initially invested
*/
function getAssetValue(currentPrice, initialPrice, initialInvestment) {
  return currentPrice * (initialInvestment / initialPrice);
}

/*
The ShowResults component
*/
const ShowResults = ({ portfolio=samplePortfolio }) => {
  const [chartLoaded, setChartLoaded] = useState(false);
  const [chartSeries, setChartSeries] = useState(null);
  const [finalTotalValue, setFinalTotalValue] = useState(0);

  const chartOptions = {
    chart: {
      width: "100%",
    },
    xaxis: {
      type: "datetime",
    }
  };

  async function updateChart() {
    // Get the stock data from the Marketstack API
    const stockSymbols = portfolio.assets.map((asset) => asset.symbol);
    const startDate = portfolio.startDate;
    const stockData = await getStockData(stockSymbols, startDate);

    const d = stockData["data"];

    // Get the initial amount of money invested into each stock
    const initialValues = new Map(
      portfolio.assets.map((asset) => [asset.symbol, asset.portion * portfolio.initial])
    );

    /*
      For each stock, build an array to store its value over time
    */
    const valueData = new Map(
      stockSymbols.map((symbol) => [symbol, []])
    );

    // Build an array to store the total value of the portfolio over time
    let totalValue = [];

    // Build an array to store the initial price of each stock
    const initialPrices = new Map();
    
    /*
    Iterate through all stock data returned from the API
    */
    d.forEach((datum) => {
      const date = datum.date;
      const symbol = datum.symbol;
      const closingPrice = datum.close;

      if(!initialPrices.has(symbol))
        initialPrices.set(symbol, closingPrice);

      const assetValue = getAssetValue(closingPrice, initialPrices.get(symbol), initialValues.get(symbol));

      // const assetValue = closingPrice / initialPrices.get(symbol) * initialValues.get(symbol); // Asset's value on the given date

      let v = valueData.get(symbol);
      v.push({date: date, value: assetValue});
      valueData.set(symbol, v);

      /*
      Update totalValue while ensuring that it remains sorted by date (ascending)
      */
      if((totalValue.length == 0) || (totalValue[totalValue.length-1].date != date))
        totalValue.push({date: date, value: 0});
      totalValue[totalValue.length-1].value += assetValue;
    });


    // Update the chart
    let newChartSeries = stockSymbols.map(symbol => {return {
      name: symbol,
      type: "area",
      data: valueData.get(symbol).map((datum) => {return {
        x: datum.date,
        y: datum.value.toFixed(2)
      }})
    }});
    newChartSeries.push({
      name: "Total Value",
      type: "area",
      data: totalValue.map((datum) => {return {
        x: datum.date,
        y: datum.value.toFixed(2)
      }})
    });

    setChartSeries(newChartSeries);
    setFinalTotalValue(totalValue[totalValue.length-1].value);
    setChartLoaded(true);
  } 

  return (
    <div>
      {(chartLoaded && chartOptions && chartSeries) && 
        <div>
          <Chart
            type="area"
            options={chartOptions}
            series={chartSeries}
            width="500"
          />
          <h3>
            Total value: {'$' + finalTotalValue.toFixed(2)}
          </h3>
        </div>

      }
      <button onClick={updateChart}>
        Load chart
      </button>
    </div>
  );
};

export default ShowResults;