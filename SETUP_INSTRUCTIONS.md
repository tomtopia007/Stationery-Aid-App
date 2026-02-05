# Google Sheets Setup Instructions

Follow these steps to set up your volunteer tracker database.

## Step 1: Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Click **"+ Blank"** to create a new spreadsheet
3. Name it: **"Stationery Aid Volunteer Tracker"**

---

## Step 2: Add the Apps Script

1. In your new spreadsheet, click **Extensions** → **Apps Script**
2. Delete any existing code in the editor
3. Copy the ENTIRE contents of `google-apps-script.js` (in your volunteer-tracker folder)
4. Paste it into the Apps Script editor
5. Click the **💾 Save** icon (or Ctrl+S)
6. Name the project: **"VolunteerTrackerAPI"**

---

## Step 3: Initialize the Sheets

1. In the Apps Script editor, find the function dropdown (says "Select function")
2. Select **`initializeSheets`**
3. Click the **▶ Run** button
4. When prompted, click **"Review permissions"**
5. Select your Google account
6. Click **"Advanced"** → **"Go to VolunteerTrackerAPI (unsafe)"**
7. Click **"Allow"**
8. Wait for it to complete (you'll see "Execution completed" at bottom)

✅ **Check your spreadsheet** - you should now see 4 tabs:

- Volunteers
- Hours  
- Shifts
- Managers (with your email already added)

---

## Step 4: Deploy as Web App

1. In Apps Script, click **Deploy** → **New deployment**
2. Click the ⚙️ gear icon → Select **"Web app"**
3. Fill in:
   - **Description**: "Volunteer Tracker API v1"
   - **Execute as**: "Me"
   - **Who has access**: "Anyone"
4. Click **Deploy**
5. Click **"Authorize access"** if prompted (same steps as before)
6. **IMPORTANT**: Copy the **Web app URL** that appears
   - It looks like: `https://script.google.com/macros/s/AKfycb.../exec`
7. Click **Done**

---

## Step 5: Save Your Web App URL

⚠️ **You need to give me this URL!**

Paste the Web App URL here so I can configure the app to connect to your Google Sheet.

---

## Troubleshooting

### "Authorization required" error

- Make sure you completed Step 3 (initializing) before deploying

### "Script function not found"

- Make sure you saved the script (Ctrl+S) before running

### Sheets not created

- Run `initializeSheets` function again

---

## Security Notes

- Only your email (<tomtopia007@gmail.com>) has manager access initially
- You can add more managers from within the app once it's connected
- Volunteers don't need a Google account - they log in with name/email/phone
