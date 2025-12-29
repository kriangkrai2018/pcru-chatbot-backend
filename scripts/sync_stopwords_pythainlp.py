#!/usr/bin/env python3
"""
Sync Thai stopwords from pythainlp to MySQL database
This script should be run once during setup or when updating stopwords

Requirements:
    pip install pythainlp mysql-connector-python python-dotenv

Usage:
    python scripts/sync_stopwords_pythainlp.py
"""

import os
import sys
import mysql.connector
from mysql.connector import Error
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def get_pythainlp_stopwords():
    """Get Thai stopwords from pythainlp library"""
    try:
        from pythainlp.corpus import thai_stopwords
        stopwords = list(thai_stopwords())
        print(f"✅ Loaded {len(stopwords)} stopwords from pythainlp")
        return stopwords
    except ImportError:
        print("❌ pythainlp not installed!")
        print("💡 Install with: pip install pythainlp")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error loading stopwords from pythainlp: {e}")
        sys.exit(1)

def connect_to_database():
    """Connect to MySQL database"""
    try:
        connection = mysql.connector.connect(
            host=os.getenv('DB_HOST', 'project.3bbddns.com'),
            user=os.getenv('DB_USER', 'root'),
            password=os.getenv('DB_PASSWORD', ''),
            database=os.getenv('DB_NAME', 'pcru_chatbot'),
            charset='utf8mb4',
            collation='utf8mb4_unicode_ci'
        )
        
        if connection.is_connected():
            db_info = connection.get_server_info()
            print(f"✅ Connected to MySQL Server version {db_info}")
            return connection
    except Error as e:
        print(f"❌ Error connecting to MySQL: {e}")
        print("\n💡 Solutions:")
        print("   1. Check .env file for correct DB credentials")
        print("   2. Make sure MySQL server is running")
        print("   3. Check if database exists")
        sys.exit(1)

def sync_stopwords(connection, stopwords, batch_size=None):
    """Insert stopwords into database with optional batch processing"""
    cursor = connection.cursor()
    
    try:
        # Check if table exists
        cursor.execute("SHOW TABLES LIKE 'Stopwords'")
        if not cursor.fetchone():
            print("❌ Stopwords table does not exist!")
            print("💡 Run: mysql -u [user] -p [database] < database/create_stopwords_table.sql")
            sys.exit(1)
        
        # Get existing stopwords
        cursor.execute("SELECT StopwordText FROM Stopwords")
        existing = set(row[0].lower() for row in cursor.fetchall())
        print(f"📊 Found {len(existing)} existing stopwords in database")
        
        # Get negative keywords to avoid duplicates
        cursor.execute("SELECT Word FROM NegativeKeywords WHERE IsActive = 1")
        negative_keywords = set(row[0].lower() for row in cursor.fetchall())
        print(f"🚫 Found {len(negative_keywords)} active negative keywords")
        
        # Load previously removed stopwords to avoid re-adding them
        removed_stopwords = set()
        try:
            import json
            with open('nonstandard_stopwords_report.json', 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'all' in data:
                    removed_stopwords = set(word.lower() for word in data['all'])
                print(f"🗑️ Found {len(removed_stopwords)} previously removed stopwords")
        except (FileNotFoundError, json.JSONDecodeError, KeyError):
            print("ℹ️ No removed stopwords file found, proceeding without it")
        
        # Filter new stopwords: not in existing AND not in negative keywords AND not previously removed
        new_stopwords = [sw for sw in stopwords if sw.lower() not in existing and sw.lower() not in negative_keywords and sw.lower() not in removed_stopwords]
        
        if not new_stopwords:
            print("✨ All valid stopwords are already in database!")
            return
        
        total_to_insert = len(new_stopwords)
        print(f"📝 Found {total_to_insert} new stopwords to insert")
        
        if batch_size and total_to_insert > batch_size:
            print(f"🔄 Using batch processing with size {batch_size}")
            inserted_count = 0
            
            for i in range(0, total_to_insert, batch_size):
                batch = new_stopwords[i:i + batch_size]
                print(f"📦 Processing batch {i//batch_size + 1}/{(total_to_insert + batch_size - 1)//batch_size} ({len(batch)} words)...")
                
                # Insert batch
                insert_query = "INSERT IGNORE INTO Stopwords (StopwordText) VALUES (%s)"
                cursor.executemany(insert_query, [(sw,) for sw in batch])
                connection.commit()
                
                batch_inserted = cursor.rowcount
                inserted_count += batch_inserted
                print(f"   ✅ Inserted {batch_inserted} stopwords in this batch")
                
                # Optional: Add delay between batches to avoid overwhelming the database
                if i + batch_size < total_to_insert:
                    import time
                    time.sleep(0.1)  # 100ms delay
            
            print(f"✅ Successfully inserted {inserted_count} stopwords in total")
        else:
            print(f"📝 Inserting {total_to_insert} new stopwords (excluding duplicates with negative keywords and previously removed words)...")
            
            # Insert all new stopwords at once
            insert_query = "INSERT IGNORE INTO Stopwords (StopwordText) VALUES (%s)"
            cursor.executemany(insert_query, [(sw,) for sw in new_stopwords])
            connection.commit()
            
            print(f"✅ Successfully inserted {cursor.rowcount} stopwords")
        
        # Show summary
        cursor.execute("SELECT COUNT(*) FROM Stopwords")
        total = cursor.fetchone()[0]
        print(f"📊 Total stopwords in database: {total}")
        
        # Show sample
        cursor.execute("SELECT StopwordText FROM Stopwords ORDER BY StopwordText LIMIT 20")
        print("\n📋 Sample stopwords:")
        for row in cursor.fetchall():
            print(f"   - {row[0]}")
            
    except Error as e:
        print(f"❌ Error syncing stopwords: {e}")
        connection.rollback()
        sys.exit(1)
    finally:
        cursor.close()

def main():
    print("=" * 60)
    print("🔄 Syncing Thai Stopwords from pythainlp to MySQL")
    print("=" * 60)
    
    # Step 1: Get stopwords from pythainlp
    stopwords = get_pythainlp_stopwords()
    
    # Step 2: Connect to database
    connection = connect_to_database()
    
    # Step 3: Sync stopwords
    try:
        sync_stopwords(connection, stopwords)
    finally:
        if connection.is_connected():
            connection.close()
            print("\n🔌 Database connection closed")
    
    print("\n" + "=" * 60)
    print("✨ Sync completed successfully!")
    print("💡 Restart your Node.js server to reload stopwords cache")
    print("=" * 60)

if __name__ == "__main__":
    main()
