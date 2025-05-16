# ScaleFlow: AI-Powered Supply Chain Risk Prediction

**ScaleFlow** is a full-stack, containerized platform that uses machine learning models, batch-processed data pipelines, and a real-time chatbot interface driven by artificial intelligence to forecast supply chain risks. It provides scalable insights from financial, trade, and macroeconomic datasets and is built with Apache Airflow, PostgreSQL, and Docker. It is also integrated with LangChain and GPT-4o. This repository showcases the project built for the **CSCI-6502: Big Data Analytics** course at the **University of Colorado Boulder**.

---

## 🗂️ Table of Contents

* [Project Overview](#-project-overview)
* [Architecture Diagram](#-architecture-diagram)
* [Features](#-features)
* [Backend Overview](#-backend-overview)
* [Frontend Overview](#-frontend-overview)
* [Data Sources](#-data-sources)
* [Evaluation Metrics](#-evaluation-metrics)
* [Deployment](#-deployment)
* [Setup Instructions](#-setup-instructions)
* [Folder Structure](#-folder-structure)
* [Future Work](#-future-work)
* [License](#-license)

---

## 🧠 Project Overview

Supply chain disruptions—from natural disasters to macroeconomic shocks—pose major risks to global commerce. **ScaleFlow** predicts potential disruptions by leveraging historical data, economic indicators, weather data, and market sentiment through machine learning. It also offers real-time insights via a chat-based Q\&A interface built with LangChain and OpenAI LLMs.

---

## 🏗️ Architecture Diagram

![Architecture](https://raw.githubusercontent.com/jaymalave/raycaster-qna/refs/heads/main/public/arch.png)

---

## 🚀 Features

* Batch ETL pipelines for economic, logistics, and financial data
* Multi-threaded data extraction + API rate limit handling
* PostgreSQL-based storage + scalable Airflow DAGs
* Machine learning model training with XGBoost, Decision Trees
* ML evaluation using SHAP, Precision, Recall, AUC-ROC
* Real-time Q\&A assistant using LangChain and GPT-4o
* Frontend built with React, Tailwind, and Vercel AI SDK

---

## ⚙️ Backend Overview

### 🔧 Technologies Used:

* **Apache Airflow** (ETL Orchestration)
* **Docker + Docker Compose** (Containerization)
* **PostgreSQL** (Relational Storage)
* **Python** (ETL + ML Pipelines)
* **MLflow** (Model Drift Monitoring)

### Key Components:

* `/dags`: Airflow DAGs for UN Comtrade, World Bank, Yahoo Finance
* `/scripts`: Threaded extraction, cleaning, and loading logic
* `stress_modes`: Dynamically scale pipeline load via Airflow Variables
* Aggregation DAGs benchmark DB under heavy SQL operations

---

## 💬 Frontend Overview

### 🛠️ Tech Stack:

* **React + Next.js 14+ (App Router)**
* **Tailwind CSS** for styling
* **Supabase** for block-level sheet data
* **Pinecone** for semantic search
* **OpenAI GPT-4o** for Q\&A and embeddings
* **LangChain** for orchestration
* **Vercel AI SDK** for streaming chat

### Data Flow Summary:

1. User submits a query via chat interface
2. `/api/qa` processes input using `MatrixQAService`
3. Plans retrieval steps using LLMs + schema awareness
4. Fetches evidence using Pinecone and Supabase
5. Streams synthesized response with citation metadata
6. Frontend parses metadata and renders annotated output

### API Endpoint:

```http
POST /api/qa
Content-Type: application/json
```

---

## 📊 Data Sources

* **UN Comtrade API** — Global trade statistics
* **World Bank API** — GDP, inflation, macro indicators
* **Yahoo Finance** — 6000+ tickers, 20 years of stock data
* **OpenWeather API** — Weather and disaster logs (optional)

---

## 🤖 Machine Learning Models

* **Algorithms:** Logistic Regression, Decision Trees, XGBoost
* **Features:** Supplier performance, economic indicators, weather
* **Training:** Batched mode with hyperparameter tuning
* **Explainability:** SHAP analysis

---

## 📈 Evaluation Metrics

### Risk Prediction Models:

* Precision, Recall, AUC-ROC
* FPR/FNR, Confusion Matrix

### Chatbot:

* Latency & Response Speed
* Query Relevance Score
* Citation Accuracy

---

## 🚀 Deployment

* **Backend API:** FastAPI/Flask (Optional)
* **Cloud:** GCP Cloud Run or AWS Lambda (Optional)
* **Frontend:** Vercel-hosted React frontend (Next.js)
* **Dockerized Setup:** Local Airflow + PostgreSQL stack

---

## 🛠️ Setup Instructions

```bash
# Clone the repo
$ git clone https://github.com/your-username/scaleflow.git
$ cd scaleflow

# Copy and configure environment variables
$ cp .env.example .env

# Start Docker containers
$ docker-compose up --build -d

# Access Airflow UI
Visit: http://localhost:8080
```

---

## 🧱 Folder Structure

```
scaleflow/
├── backend/
│   ├── dags/                  # Airflow DAGs
│   ├── scripts/               # Python ETL Scripts
│   ├── config/                # API keys and secrets
│   ├── output_data/           # Output CSVs, logs
│   └── requirements.txt       # Python dependencies
├── frontend/
│   ├── app/                   # Next.js entry
│   ├── components/            # Chat UI components
│   ├── pages/api/qa.ts        # Matrix QA API endpoint
│   └── services/              # Agents, LangChain logic
├── database/
│   └── schema.sql             # PostgreSQL schema
├── docker-compose.yml         # Local stack
├── .env.example               # Sample ENV variables
├── LICENSE
└── README.md
```

---

## 🔮 Future Work

* Integrate SHAP-based interpretability dashboards
* Real-time streaming using Kafka or Flink
* Chatbot memory and history personalization
* Deploy across multiple industry domains
* Serverless global deployment (Cloud Run, Lambda)

---
