# Thai Stopwords Sync with pythainlp

## Installation

```bash
# Install Python dependencies
pip install pythainlp mysql-connector-python python-dotenv
```

## Usage

```bash
# Run the sync script
python scripts/sync_stopwords_pythainlp.py
```

## What it does

1. Loads Thai stopwords from pythainlp library
2. Connects to MySQL database
3. Inserts new stopwords (skips existing ones)
4. Shows summary and sample stopwords

## Environment Variables

Make sure your `.env` file has:

```env
DB_HOST=project.3bbddns.com
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=pcru_chatbot
```

## After Running

Restart your Node.js backend server to reload the stopwords cache:

```bash
npm start
# or
node server.js
```

## Troubleshooting

### pythainlp not found
```bash
pip install pythainlp
```

### MySQL connection error
- Check `.env` file for correct credentials
- Make sure MySQL server is running
- Verify database exists

### Table not found
```bash
mysql -u root -p pcru_chatbot < database/create_stopwords_table.sql
```
