import React, { useRef, useState } from 'react';
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

// Sample Data from the TwelveData API for stocks AAPL, GOOG, and MSFT
const sampleData = require('../twelve-data-sample-data.json');

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
For a given Date object, create a string in the format
YYYY-MM-DD,
to supply to the Marketstack or Twelvedata APIs
*/
function formatDateStr(date) {
  const y = date.getUTCFullYear().toString().padStart(4,'0');
  const m = date.getUTCMonth().toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/*
The ShowResults component
*/
const ShowResults = ({ portfolio=samplePortfolio }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [chartLoaded, setChartLoaded] = useState(false);
  const [chartSeries, setChartSeries] = useState(null);
  const [finalTotalValue, setFinalTotalValue] = useState(0);
  const [finalStockValues, setFinalStockValues] = useState(new Map());
  const [errMsg, setErrMsg] = useState("");

  const rawStockData = useRef(null);

  const chartOptions = {
    chart: {
      width: "100%",
    },
    xaxis: {
      type: "datetime",
    },
    yaxis: {
      labels: {
        formatter: function(value, index) {
          return '$' + value.toFixed(2);
        }
      }
    },
    // https://apexcharts.com/javascript-chart-demos/bar-charts/custom-datalabels/
    dataLabels: {
      enabled: false,
    },
  };

  /*
  Get stock data from the TwelveData API

  NOTE: The Twelvedata support website indicates that all interday data is adjusted for splits:
  https://support.twelvedata.com/en/articles/5179064-are-the-prices-adjusted
  */
  async function getRawStockData() {

    if(rawStockData.current)
      return rawStockData.current;

    let useSampleData = true;
    // useSampleData = false; // comment this line out for quick toggling

    if(useSampleData) {
      rawStockData.current = sampleData;
      return sampleData;
    }

    const symbols = portfolio.assets.map((a) => a.symbol);

    //const apiKey = "2a40d800b1f04ff89acb706ec4b7e674";
    const apiKey = "f";
    const requestURL = "https://api.twelvedata.com/time_series?"
    + new URLSearchParams({
      apikey: apiKey,
      symbol: symbols.join(','),
      interval: "1month",
      date_from: formatDateStr(new Date(portfolio.startDate)),
      date_to: formatDateStr(new Date()),
      // sort: "ASC" // Seems to not work for some reason
    });

    const reqResponse = await fetch(requestURL);
    if(reqResponse.status == 200) {
      const jsonData = await reqResponse.json();
      rawStockData.current = jsonData;
      return jsonData;
    }
    else {
      setErrMsg("Sorry, but something went wrong.");
      return null;
    }

  }

  /*
  Update the chart, using the raw stock data
  */
  async function updateChartV2() {
    setIsLoading(true);

    const stockData = await getRawStockData();
    if(stockData === null)
      return; //TODO: error handling

    const stockSymbols = portfolio.assets.map((asset) => asset.symbol);

    /*
    Ensure that data for all stocks in the portfolio was successfully retrieved
    */
    stockSymbols.forEach((symbol) => {
      if((!stockData[symbol]) || (stockData[symbol].status !== "ok")) {
        setErrMsg("Sorry, but data could not be retrieved for every stock in your portfolio.");
        return;
      }
    })

    /*
    Get the number of shares purchased for each stock in the portfolio
    */
    const sharesBought = new Map();
    portfolio.assets.forEach((asset) => {
      const assetData = stockData[asset.symbol].values;
      const initialPrice = assetData[assetData.length - 1].close; // assume descending order
      const amountInvested = asset.portion * portfolio.initial;
      sharesBought.set(asset.symbol, amountInvested / initialPrice);
    });

    //should we assume that if information on a given date is available for one stock, information will be available for every stock on that date?

    /*
    For each stock, record its value over time, in a format
    that can be passed to the chart thing
    */
    const stockValuesByDate = new Map(
      stockSymbols.map((symbol) => [symbol, new Map()])
    );
    const allDates = new Set(); // all dates for which data is available for at least one stock

    stockSymbols.forEach((symbol) => {
      stockData[symbol]["values"].forEach((tradingDay) => {
        const date = tradingDay.datetime;
        const closingPrice = tradingDay.close;
        const assetValue = sharesBought.get(symbol) * closingPrice;
        stockValuesByDate.get(symbol).set(date, assetValue); 

        allDates.add(date);
      })
    });

    /*
    For each stock, as well as the total portfolio value over time, create a series of objects that can be supplied to the ApexCharts Chart component.
    */
    const seriesNames = stockSymbols.concat(["Total"]);

    let newChartSeries = {};
    seriesNames.forEach((sName) => {
      newChartSeries[sName] = {
        name: sName,
        type: "area",
        data: []
      };
    });

    // Sort the dates
    const datesSorted = (Array.from(allDates));
    datesSorted.sort((a,b)=>(new Date(a) - new Date(b)));
    console.log(datesSorted);

    /*
    Calculate the total portfolio value over time
    If data is unavailable for a given stock on a certain date,
    assume that the stock's value was equal to its most recently known value
    */
    const currentValues = new Map(
      stockSymbols.map((symbol) => [symbol, 0])
    );
    let portfolioValue = 0;

    datesSorted.forEach((date) => {
      stockSymbols.forEach((symbol) => {
        if(stockValuesByDate.get(symbol).has(date)) {
          const value = stockValuesByDate.get(symbol).get(date);
          currentValues.set(symbol, value);
          // Add new object for the chart series
          newChartSeries[symbol].data.push({
            x: date,
            y: value.toFixed(2)
          });
        }
      });
      // Calculate the total portfolio value for the given date
      portfolioValue = 0;
      stockSymbols.forEach((symbol) => {
        portfolioValue += currentValues.get(symbol);
      });
      newChartSeries["Total"].data.push({
        x: date,
        y: portfolioValue.toFixed(2)
      });

    });

    setChartSeries(Array.from(seriesNames.map((sName) => newChartSeries[sName])));
    setFinalStockValues(stockSymbols.map((symbol) => {
      return {
        symbol: symbol,
        value: currentValues.get(symbol)
      }
    }));
    setFinalTotalValue(portfolioValue);

    setChartLoaded(true);
    setIsLoading(false);

  }

  return (
    <div className={styles.showResults}>
      {
        isLoading ? (
          <div>
            loading
          </div>
        )
        : <>
          
          {(chartLoaded && chartOptions && chartSeries) ? 
            <>
            {/* note: still need to figure out proper way to do styles in next.js */}
            <div className={styles.chartContainer} >
              <Chart
                type="area"
                options={chartOptions}
                series={chartSeries}
              />
            </div>
            <h2>
              Your portfolio's value today:
            </h2>
            <h3>
              Total: {'$' + finalTotalValue.toFixed(2)}
            </h3>
            {
              finalStockValues.map((data) => (
                <h4>
                  {data.symbol}: {`$${data.value.toFixed(2)}`}
                </h4>
              ))
            }
            </>
          
          : <div>
              <button onClick={updateChartV2}>
              Load chart
              </button>
            </div>
                  
          }
        </>}
      </div>

  );
};

export default ShowResults;