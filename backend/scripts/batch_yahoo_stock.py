import yfinance as yf
import pandas as pd
import os
import time
import random
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# === CONFIGURATION ===
TICKER_FILE = "/opt/airflow/helper_datasets/companies.csv"
OUTPUT_FOLDER = "/opt/airflow/yahoo_finance_dataset"
THREADS = 10
BATCH_SIZE = 50
BATCH_PAUSE = 10  # seconds
DEFAULT_START = datetime(2000, 1, 1)
END_DATE = datetime(2024, 12, 31)
RETRY_LIMIT = 3
RETRY_DELAY = 5  # seconds

# === SETUP ===
os.makedirs(OUTPUT_FOLDER, exist_ok=True)
tickers_df = pd.read_csv(TICKER_FILE)
tickers = tickers_df['ticker'].dropna().unique().tolist()
random.shuffle(tickers)  # Optional
tickers = tickers[:500]

print(f"Processing {len(tickers)} tickers with {THREADS} threads...")

# === Storage ===
results = []
combined_data = []

def fetch_stock_data(ticker):
    try:
        stock = yf.Ticker(ticker)
        info = stock.info

        # Establishment year logic
        founded_year = info.get("founded") or info.get("startDate") or info.get("yearFounded")
        if isinstance(founded_year, int) and founded_year >= 2000:
            start_date = datetime(founded_year, 1, 1)
        else:
            start_date = DEFAULT_START

        hist = stock.history(start=start_date, end=END_DATE)

        # Throttle slightly to avoid mass hammering
        time.sleep(random.uniform(1.5, 3.5))

        if hist.empty:
            return None, f"[SKIPPED] {ticker}: No data available."

        hist.reset_index(inplace=True)
        hist['Ticker'] = ticker
        return hist, f"[SUCCESS] {ticker} from {start_date.year} to {END_DATE.year}"
    except Exception as e:
        if "Rate limit" in str(e) or "Too Many Requests" in str(e):
            return None, f"[RETRY] {ticker}: Rate limited. {e}"
        return None, f"[FAILED] {ticker}: {e}"

def fetch_with_retries(ticker):
    for attempt in range(RETRY_LIMIT):
        data, log = fetch_stock_data(ticker)
        if not log.startswith("[RETRY]"):
            return data, log
        print(f"[Retry] {ticker} (attempt {attempt + 1})")
        time.sleep(RETRY_DELAY * (attempt + 1))
    return None, f"[FAILED] {ticker} after {RETRY_LIMIT} retries (rate limit)"

# === BATCHED EXECUTION ===
for i in range(0, len(tickers), BATCH_SIZE):
    batch = tickers[i:i+BATCH_SIZE]
    print(f"\nStarting batch {i//BATCH_SIZE + 1} ({len(batch)} tickers)")
    with ThreadPoolExecutor(max_workers=THREADS) as executor:
        futures = {executor.submit(fetch_with_retries, ticker): ticker for ticker in batch}
        for future in as_completed(futures):
            data, log = future.result()
            results.append(log)
            print(log)
            if data is not None:
                combined_data.append(data)

    print(f"Sleeping {BATCH_PAUSE} seconds before next batch...")
    time.sleep(BATCH_PAUSE)

# === SAVE RESULTS ===
if combined_data:
    final_df = pd.concat(combined_data, ignore_index=True)
    combined_path = os.path.join(OUTPUT_FOLDER, "all_tickers_combined.csv")
    final_df.to_csv(combined_path, index=False)
    print(f"\nCombined data saved to: {combined_path}")

with open(os.path.join(OUTPUT_FOLDER, "fetch_log.txt"), "w") as f:
    f.write("\n".join(results))

print("\nMultithreaded combined extraction complete with rate-limit handling.")