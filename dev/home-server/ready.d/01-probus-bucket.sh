#!/bin/bash
# Create the bucket the app's S3 sheet talks to, and a CORS rule so a page on
# another origin (the Vite server, a phone on the LAN) can PUT and GET it.
set -euo pipefail

awslocal s3 mb s3://probus 2>/dev/null || true
awslocal s3api put-bucket-cors --bucket probus --cors-configuration '{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "HEAD", "POST"],
      "AllowedOrigins": ["*"],
      "ExposeHeaders": ["ETag", "x-amz-request-id"],
      "MaxAgeSeconds": 3000
    }
  ]
}'
