# Run Local Server for Volunteer Hub

## Quick Start

To test Google Sign-In, you need to run the app through a local web server.

### Option 1: Python (if installed)

Open a terminal in the volunteer-tracker folder and run:

```
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

### Option 2: Double-click start-server.bat

A batch file has been created for you - just double-click `start-server.bat`

## Important

After starting the server, you need to add `http://localhost:8000` to your Google Cloud Console:

1. Go to <https://console.cloud.google.com/apis/credentials>
2. Click on your OAuth 2.0 Client ID
3. Under "Authorized JavaScript origins", add: `http://localhost:8000`
4. Save

Then Google Sign-In will work!
