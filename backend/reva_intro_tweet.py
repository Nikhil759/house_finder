import os

import tweepy
from dotenv import load_dotenv

load_dotenv()

TWEET_TEXT = (
    "Renting in Bangalore is a full-time job. Fake listings, broker spam, "
    "deposits that cost more than a used car. Someone had to start talking "
    "about it honestly. That someone is me, Reva! Daily rental intel → https://nestiq.homes/"
)

client = tweepy.Client(
    consumer_key=os.getenv("TWITTER_CONSUMER_KEY"),
    consumer_secret=os.getenv("TWITTER_CONSUMER_KEY_SECRET"),
    access_token=os.getenv("TWITTER_ACCESS_TOKEN"),
    access_token_secret=os.getenv("TWITTER_ACCESS_TOKEN_SECRET"),
)

response = client.create_tweet(text=TWEET_TEXT)
tweet_id = response.data["id"]

print(f"Tweet posted successfully!")
print(f"Text: {TWEET_TEXT}")
print(f"Tweet ID: {tweet_id}")
