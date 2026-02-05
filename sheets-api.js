// ========================================
// Volunteer Hours Tracker - Sheets API Client
// ========================================

const SHEETS_API_URL = 'https://script.google.com/a/macros/stationeryaid.org/s/AKfycbx-ff1y4kzrCmHGx-FgaFOof8IsUrnd5q5xt9z8cckD5yRIpLlaRmb-F1AKff0llBPBww/exec';

// ========================================
// API Helper Functions
// ========================================

async function callSheetsAPI(action, params = {}) {
    const url = new URL(SHEETS_API_URL);
    url.searchParams.append('action', action);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            url.searchParams.append(key, typeof value === 'object' ? JSON.stringify(value) : value);
        }
    }

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            mode: 'cors'
        });

        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Sheets API Error:', error);
        return { success: false, error: error.message };
    }
}

// ========================================
// Data Operations
// ========================================

async function fetchAllData() {
    showLoading('Syncing with cloud...');
    try {
        const result = await callSheetsAPI('getData');
        hideLoading();

        if (result.success) {
            appData.volunteers = result.data.volunteers;
            appData.shifts = result.data.shifts;
            appData.managers = result.data.managers;
            appData.lastUpdated = result.data.lastUpdated;
            updateLastUpdatedDisplay();
            return true;
        } else {
            showError('Failed to sync: ' + result.error);
            return false;
        }
    } catch (e) {
        hideLoading();
        console.error('fetchAllData error:', e);
        showError('Failed to sync: ' + e.message);
        return false;
    }
}

async function saveVolunteerToCloud(volunteer) {
    // Strip hours array - it's synced separately and can make URL too long
    const volunteerData = {
        id: volunteer.id,
        name: volunteer.name,
        phone: volunteer.phone || '',
        email: volunteer.email || '',
        address: volunteer.address || '',
        suburb: volunteer.suburb || '',
        emergencyContact: volunteer.emergencyContact || ''
    };

    console.log('Saving volunteer to cloud:', volunteerData.name);
    const result = await callSheetsAPI('saveVolunteer', { data: volunteerData });
    if (!result.success) {
        console.error('saveVolunteerToCloud failed for', volunteer.name, 'Error:', result.error || 'No error message');
    }
    return result.success;
}

async function deleteVolunteerFromCloud(id) {
    const result = await callSheetsAPI('deleteVolunteer', { id });
    return result.success;
}

async function saveHoursToCloud(hoursData) {
    const result = await callSheetsAPI('saveHours', { data: hoursData });
    return result.success;
}

async function deleteHoursFromCloud(volunteerId, entryId) {
    const result = await callSheetsAPI('deleteHours', { volunteerId, entryId });
    return result.success;
}

async function saveShiftToCloud(shift) {
    const result = await callSheetsAPI('saveShift', { data: shift });
    return result.success;
}

async function deleteShiftFromCloud(id) {
    const result = await callSheetsAPI('deleteShift', { id });
    return result.success;
}

async function applyForShiftInCloud(shiftId, volunteerId, notes) {
    const result = await callSheetsAPI('applyForShift', { shiftId, volunteerId, notes });
    return result;
}

async function removeApplicantFromCloud(shiftId, volunteerId) {
    const result = await callSheetsAPI('removeApplicant', { shiftId, volunteerId });
    return result.success;
}

async function addManagerToCloud(email, adminEmail) {
    const result = await callSheetsAPI('addManager', { email, adminEmail });
    return result;
}

async function removeManagerFromCloud(email, adminEmail) {
    const result = await callSheetsAPI('removeManager', { email, adminEmail });
    return result;
}

async function getPendingReviewsFromCloud() {
    const result = await callSheetsAPI('getPendingReviews');
    return result;
}

async function submitShiftReviewToCloud(reviewData) {
    const result = await callSheetsAPI('submitShiftReview', { data: reviewData });
    return result;
}

// SheetsAPI object for cleaner access
const SheetsAPI = {
    getPendingReviews: getPendingReviewsFromCloud,
    submitShiftReview: submitShiftReviewToCloud
};

// ========================================
// Authentication
// ========================================

async function volunteerLoginAPI(name, email, phone) {
    showLoading('Verifying credentials...');
    const result = await callSheetsAPI('volunteerLogin', { name, email, phone });
    hideLoading();
    return result;
}

async function managerLoginAPI(email) {
    showLoading('Verifying manager access...');
    const result = await callSheetsAPI('managerLogin', { email });
    hideLoading();
    return result;
}

// ========================================
// Session Management
// ========================================

const SESSION_KEY = 'volunteerTrackerSession';

function saveSession(userType, userData) {
    const session = {
        userType, // 'volunteer' or 'manager'
        userData,
        loginTime: new Date().toISOString()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function getSession() {
    const sessionStr = localStorage.getItem(SESSION_KEY);
    if (sessionStr) {
        try {
            return JSON.parse(sessionStr);
        } catch {
            return null;
        }
    }
    return null;
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

function isLoggedIn() {
    return getSession() !== null;
}

function getCurrentUser() {
    const session = getSession();
    return session ? session.userData : null;
}

function getUserType() {
    const session = getSession();
    return session ? session.userType : null;
}

// ========================================
// UI Helpers
// ========================================

function showLoading(message = 'Loading...') {
    let loader = document.getElementById('globalLoader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'globalLoader';
        loader.className = 'global-loader';
        loader.innerHTML = `
            <div class="loader-content">
                <div class="loader-spinner"></div>
                <p class="loader-message">${message}</p>
            </div>
        `;
        document.body.appendChild(loader);
    } else {
        loader.querySelector('.loader-message').textContent = message;
        loader.style.display = 'flex';
    }
}

function hideLoading() {
    const loader = document.getElementById('globalLoader');
    if (loader) {
        loader.style.display = 'none';
    }
}

function showError(message) {
    alert('Error: ' + message);
}

function updateLastUpdatedDisplay() {
    const display = document.getElementById('lastUpdated');
    if (display && appData.lastUpdated) {
        const date = new Date(appData.lastUpdated);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) {
            display.textContent = 'Last updated: Just now';
        } else if (diffMins < 60) {
            display.textContent = `Last updated: ${diffMins} min ago`;
        } else {
            display.textContent = `Last updated: ${date.toLocaleTimeString()}`;
        }
    }
}

// ========================================
// Initialize
// ========================================

// Add managers array to appData
if (!appData.managers) {
    appData.managers = [];
}
if (!appData.lastUpdated) {
    appData.lastUpdated = null;
}
