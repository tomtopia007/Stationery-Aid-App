// ========================================
// Stationery Aid Volunteer Tracker - Google Apps Script
// ========================================
// This script acts as a web API for your volunteer tracker app
// Deploy as: Web App (Execute as: Me, Access: Anyone)

// ========================================
// Configuration
// ========================================
const INITIAL_ADMIN_EMAIL = 'tomtopia007@gmail.com';
const API_KEY = 'SA_2026_xK9mP2vL8nQ3wR7y';

// Actions that modify data and require manager authentication
// Note: 'applyForShift' is excluded so volunteers can still apply
const MANAGER_WRITE_ACTIONS = [
    'saveVolunteer', 'deleteVolunteer',
    'saveHours', 'deleteHours',
    'saveShift', 'deleteShift',
    'removeApplicant',
    'submitShiftReview',
    'addManager', 'removeManager'
];

// ========================================
// Rate Limiting
// ========================================

function checkRateLimit(action, identifier) {
    var cache = CacheService.getScriptCache();
    var key = 'rate_' + action + '_' + (identifier || 'global');
    var current = cache.get(key);

    var limit = getRateLimit(action);

    if (current) {
        var count = parseInt(current);
        if (count >= limit) {
            return false; // Rate limited
        }
        cache.put(key, String(count + 1), 60); // 60 second window
    } else {
        cache.put(key, '1', 60);
    }
    return true;
}

function getRateLimit(action) {
    // Read operations: more lenient
    if (action === 'getData') return 30;
    if (action === 'volunteerLogin' || action === 'managerLogin') return 10;
    if (action === 'getPendingReviews') return 20;
    // Write operations: stricter
    return 20;
}

// ========================================
// Web App Entry Points
// ========================================

function doGet(e) {
    return handleRequest(e);
}

function doPost(e) {
    return handleRequest(e);
}

function handleRequest(e) {
    // Merge URL params with POST body (POST body takes precedence)
    var params = e.parameter || {};
    if (e.postData && e.postData.contents) {
        try {
            var bodyParams = JSON.parse(e.postData.contents);
            for (var key in bodyParams) {
                if (bodyParams.hasOwnProperty(key)) {
                    params[key] = bodyParams[key];
                }
            }
        } catch (err) {
            // If body isn't valid JSON, continue with URL params only
        }
    }

    var action = params.action;
    var providedKey = params.apiKey;

    // Login actions remain public (users need to log in first)
    var publicActions = ['volunteerLogin', 'managerLogin'];

    // Check API key for non-public actions
    if (!publicActions.includes(action) && providedKey !== API_KEY) {
        return ContentService
            .createTextOutput(JSON.stringify({ success: false, error: 'Unauthorized' }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    // For write operations, verify the caller is an authorized manager
    if (MANAGER_WRITE_ACTIONS.includes(action)) {
        var managerEmail = params.managerEmail;
        if (!managerEmail) {
            return ContentService
                .createTextOutput(JSON.stringify({ success: false, error: 'Manager authentication required for this action' }))
                .setMimeType(ContentService.MimeType.JSON);
        }
        var managerCheck = managerLogin(managerEmail);
        if (!managerCheck.success) {
            return ContentService
                .createTextOutput(JSON.stringify({ success: false, error: 'Not authorized: ' + managerEmail + ' is not a manager' }))
                .setMimeType(ContentService.MimeType.JSON);
        }
    }

    // Rate limiting
    var rateLimitId = params.managerEmail || params.email || 'anonymous';
    if (!checkRateLimit(action, rateLimitId)) {
        return ContentService
            .createTextOutput(JSON.stringify({ success: false, error: 'Rate limit exceeded. Please try again in a minute.' }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    var result;

    try {
        switch (action) {
            case 'getData':
                result = getAllData();
                break;
            case 'volunteerLogin':
                result = volunteerLogin(params.name, params.email, params.phone);
                break;
            case 'managerLogin':
                result = managerLogin(params.email);
                break;
            case 'saveVolunteer':
                result = saveVolunteer(typeof params.data === 'string' ? JSON.parse(params.data) : params.data);
                break;
            case 'deleteVolunteer':
                result = deleteVolunteer(params.id);
                break;
            case 'saveHours':
                result = saveHours(typeof params.data === 'string' ? JSON.parse(params.data) : params.data);
                break;
            case 'deleteHours':
                result = deleteHours(params.volunteerId, params.entryId);
                break;
            case 'saveShift':
                result = saveShift(typeof params.data === 'string' ? JSON.parse(params.data) : params.data);
                break;
            case 'deleteShift':
                result = deleteShift(params.id);
                break;
            case 'applyForShift':
                result = applyForShift(params.shiftId, params.volunteerId, params.notes);
                break;
            case 'removeApplicant':
                result = removeApplicant(params.shiftId, params.volunteerId);
                break;
            case 'getPendingReviews':
                result = getPendingReviews();
                break;
            case 'submitShiftReview':
                result = submitShiftReview(typeof params.data === 'string' ? JSON.parse(params.data) : params.data);
                break;
            case 'addManager':
                result = addManager(params.email, params.adminEmail);
                break;
            case 'removeManager':
                result = removeManager(params.email, params.adminEmail);
                break;
            case 'initializeSheets':
                result = initializeSheets();
                break;
            default:
                result = { success: false, error: 'Unknown action' };
        }
    } catch (error) {
        result = { success: false, error: error.toString() };
    }

    return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// Initialize Sheets (Run Once)
// ========================================

function initializeSheets() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Create Volunteers sheet
    let volunteersSheet = ss.getSheetByName('Volunteers');
    if (!volunteersSheet) {
        volunteersSheet = ss.insertSheet('Volunteers');
        volunteersSheet.getRange(1, 1, 1, 7).setValues([['ID', 'Name', 'Phone', 'Email', 'Address', 'Suburb', 'EmergencyContact']]);
    }

    // Create Hours sheet
    let hoursSheet = ss.getSheetByName('Hours');
    if (!hoursSheet) {
        hoursSheet = ss.insertSheet('Hours');
        hoursSheet.getRange(1, 1, 1, 8).setValues([['EntryID', 'VolunteerID', 'Date', 'CheckIn', 'CheckOut', 'BreakStart', 'BreakEnd', 'CreatedAt']]);
    }

    // Create Shifts sheet
    let shiftsSheet = ss.getSheetByName('Shifts');
    if (!shiftsSheet) {
        shiftsSheet = ss.insertSheet('Shifts');
        shiftsSheet.getRange(1, 1, 1, 11).setValues([['ShiftID', 'Date', 'StartTime', 'EndTime', 'VolunteersNeeded', 'Description', 'BreakStart', 'BreakEnd', 'Applicants', 'CreatedAt', 'Reviewed']]);
    }

    // Create Managers sheet with initial admin
    let managersSheet = ss.getSheetByName('Managers');
    if (!managersSheet) {
        managersSheet = ss.insertSheet('Managers');
        managersSheet.getRange(1, 1, 1, 2).setValues([['Email', 'AddedDate']]);
        managersSheet.getRange(2, 1, 1, 2).setValues([[INITIAL_ADMIN_EMAIL, new Date().toISOString()]]);
    }

    return { success: true, message: 'Sheets initialized successfully' };
}

// ========================================
// Data Retrieval
// ========================================

function getAllData() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Get volunteers
    const volunteersSheet = ss.getSheetByName('Volunteers');
    const volunteersData = volunteersSheet ? getSheetData(volunteersSheet) : [];

    // Get hours
    const hoursSheet = ss.getSheetByName('Hours');
    const hoursData = hoursSheet ? getSheetData(hoursSheet) : [];

    // Get shifts
    const shiftsSheet = ss.getSheetByName('Shifts');
    const shiftsData = shiftsSheet ? getSheetData(shiftsSheet) : [];

    // Get managers
    const managersSheet = ss.getSheetByName('Managers');
    const managersData = managersSheet ? getSheetData(managersSheet) : [];

    // Convert to app format
    const volunteers = volunteersData.map(row => ({
        id: row.ID,
        name: row.Name,
        phone: row.Phone,
        email: row.Email,
        address: row.Address || '',
        suburb: row.Suburb || '',
        emergencyContact: row.EmergencyContact || '',
        hours: hoursData.filter(h => h.VolunteerID === row.ID).map(h => ({
            id: h.EntryID,
            date: h.Date,
            checkIn: h.CheckIn,
            checkOut: h.CheckOut,
            breakStart: h.BreakStart || null,
            breakEnd: h.BreakEnd || null
        }))
    }));

    const shifts = shiftsData.map(row => ({
        id: row.ShiftID,
        date: normalizeDate(row.Date),
        startTime: row.StartTime,
        endTime: row.EndTime,
        volunteersNeeded: parseInt(row.VolunteersNeeded) || 5,
        description: row.Description || '',
        breakStart: row.BreakStart || null,
        breakEnd: row.BreakEnd || null,
        applicants: row.Applicants ? JSON.parse(row.Applicants) : [],
        createdAt: row.CreatedAt
    }));

    const managers = managersData.map(row => row.Email);

    return {
        success: true,
        data: {
            volunteers,
            shifts,
            managers,
            lastUpdated: new Date().toISOString()
        }
    };
}

function getSheetData(sheet) {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const headers = data[0];

    // Columns that contain time values and need normalization
    const timeColumns = ['CheckIn', 'CheckOut', 'BreakStart', 'BreakEnd', 'StartTime', 'EndTime'];

    return data.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, i) => {
            let value = row[i];

            // Normalize time values to HH:MM format
            if (timeColumns.includes(header) && value) {
                value = normalizeTimeValue(value);
            }

            obj[header] = value;
        });
        return obj;
    });
}

// Convert Google Sheets time format to HH:MM string
function normalizeTimeValue(timeVal) {
    if (!timeVal && timeVal !== 0) return '';

    // If it's already a string in HH:MM format
    if (typeof timeVal === 'string') {
        // Strip leading apostrophe if present (used to force text format)
        let cleanTime = timeVal.replace(/^'/, '').toUpperCase().trim();

        // Handle AM/PM format
        if (cleanTime.includes(':')) {
            const isPM = cleanTime.includes('PM');
            const isAM = cleanTime.includes('AM');
            cleanTime = cleanTime.replace(/\s*(AM|PM)\s*/gi, '').trim();

            const parts = cleanTime.split(':');
            let hour = parseInt(parts[0]) || 0;
            const min = parseInt(parts[1]) || 0;

            if (isPM && hour !== 12) hour += 12;
            if (isAM && hour === 12) hour = 0;

            return String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0');
        }
        return cleanTime;
    }

    // If it's a Date object
    if (timeVal instanceof Date) {
        const hours = timeVal.getHours();
        const mins = timeVal.getMinutes();
        return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
    }

    // If it's a decimal (Google Sheets stores times as fraction of 24 hours)
    if (typeof timeVal === 'number') {
        if (timeVal >= 0 && timeVal < 1) {
            // Fraction of day: 0.375 = 9:00 AM
            const totalMinutes = Math.round(timeVal * 24 * 60);
            const hours = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
        } else if (timeVal >= 1 && timeVal <= 24) {
            // Hours as number: 9.5 = 9:30
            const hours = Math.floor(timeVal);
            const mins = Math.round((timeVal - hours) * 60);
            return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
        }
    }

    return '';
}

// ========================================
// Authentication
// ========================================

function volunteerLogin(name, email, phone) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Volunteers');
    if (!sheet) return { success: false, error: 'Volunteers sheet not found' };

    const data = getSheetData(sheet);

    // Helper to normalize phone (strip apostrophe prefix, then all non-digits for consistent comparison)
    const normalizePhone = (p) => p ? p.toString().replace(/^'/, '').replace(/\D/g, '') : '';
    const inputPhone = normalizePhone(phone);

    // Find matching volunteer
    const volunteer = data.find(v =>
        v.Name && v.Name.toLowerCase().trim() === name.toLowerCase().trim() &&
        v.Email && v.Email.toLowerCase().trim() === email.toLowerCase().trim() &&
        v.Phone && normalizePhone(v.Phone) === inputPhone
    );

    if (volunteer) {
        // Get their hours
        const hoursSheet = ss.getSheetByName('Hours');
        const hoursData = hoursSheet ? getSheetData(hoursSheet) : [];
        const volunteerHours = hoursData.filter(h => h.VolunteerID === volunteer.ID).map(h => ({
            id: h.EntryID,
            date: h.Date,
            checkIn: h.CheckIn,
            checkOut: h.CheckOut,
            breakStart: h.BreakStart || null,
            breakEnd: h.BreakEnd || null
        }));

        return {
            success: true,
            volunteer: {
                id: volunteer.ID,
                name: volunteer.Name,
                phone: volunteer.Phone,
                email: volunteer.Email,
                address: volunteer.Address || '',
                suburb: volunteer.Suburb || '',
                emergencyContact: volunteer.EmergencyContact || '',
                hours: volunteerHours
            }
        };
    }

    // Check if partial match (missing fields)
    const partialMatch = data.find(v =>
        (v.Name && v.Name.toLowerCase().trim() === name.toLowerCase().trim()) ||
        (v.Email && v.Email.toLowerCase().trim() === email.toLowerCase().trim())
    );

    if (partialMatch) {
        const missing = [];
        if (!partialMatch.Name) missing.push('name');
        if (!partialMatch.Email) missing.push('email');
        if (!partialMatch.Phone) missing.push('phone number');

        if (missing.length > 0) {
            return {
                success: false,
                error: `Your profile is incomplete. Please contact a manager to add your ${missing.join(', ')}.`,
                incomplete: true
            };
        }

        return {
            success: false,
            error: 'Details do not match. Please check your name, email, and phone number.',
            mismatch: true
        };
    }

    return { success: false, error: 'Profile not found. Please contact a manager.' };
}

function managerLogin(email) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Managers');
    if (!sheet) return { success: false, error: 'Managers sheet not found' };

    const data = getSheetData(sheet);
    const isManager = data.some(m => m.Email && m.Email.toLowerCase().trim() === email.toLowerCase().trim());

    if (isManager) {
        return { success: true, email: email };
    }

    return { success: false, error: 'Access denied. This account does not have manager permissions.' };
}

// ========================================
// Volunteer Management
// ========================================

function saveVolunteer(volunteerData) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Volunteers');
    if (!sheet) return { success: false, error: 'Volunteers sheet not found' };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // Find existing volunteer by ID
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === volunteerData.id) {
            rowIndex = i + 1; // 1-indexed
            break;
        }
    }

    // Prefix phone with apostrophe to preserve leading zeros as text
    const phoneAsText = volunteerData.phone ? "'" + volunteerData.phone.toString() : '';

    const rowData = [
        volunteerData.id,
        volunteerData.name,
        phoneAsText,
        volunteerData.email,
        volunteerData.address || '',
        volunteerData.suburb || '',
        volunteerData.emergencyContact || ''
    ];

    if (rowIndex > 0) {
        // Update existing
        sheet.getRange(rowIndex, 1, 1, 7).setValues([rowData]);
    } else {
        // Add new
        sheet.appendRow(rowData);
    }

    return { success: true, id: volunteerData.id };
}

function deleteVolunteer(id) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Volunteers');
    if (!sheet) return { success: false, error: 'Volunteers sheet not found' };

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === id) {
            sheet.deleteRow(i + 1);

            // Also delete their hours
            deleteVolunteerHours(id);

            return { success: true };
        }
    }

    return { success: false, error: 'Volunteer not found' };
}

function deleteVolunteerHours(volunteerId) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Hours');
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();

    // Delete from bottom to top to avoid index issues
    for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][1] === volunteerId) {
            sheet.deleteRow(i + 1);
        }
    }
}

// ========================================
// Hours Management
// ========================================

function saveHours(hoursData) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Hours');
    if (!sheet) return { success: false, error: 'Hours sheet not found' };

    const data = sheet.getDataRange().getValues();

    // Find existing hours entry by ID (upsert pattern)
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === hoursData.id) {
            rowIndex = i + 1; // 1-indexed
            break;
        }
    }

    // Prefix time values with apostrophe to prevent Google Sheets auto-conversion
    const formatTime = (t) => t ? "'" + t : '';

    const rowData = [
        hoursData.id,
        hoursData.volunteerId,
        hoursData.date,
        formatTime(hoursData.checkIn),
        formatTime(hoursData.checkOut),
        formatTime(hoursData.breakStart),
        formatTime(hoursData.breakEnd),
        new Date().toISOString()
    ];

    if (rowIndex > 0) {
        // Update existing row
        sheet.getRange(rowIndex, 1, 1, 8).setValues([rowData]);
    } else {
        // Add new row
        sheet.appendRow(rowData);
    }

    return { success: true, id: hoursData.id };
}

function deleteHours(volunteerId, entryId) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Hours');
    if (!sheet) return { success: false, error: 'Hours sheet not found' };

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === entryId && data[i][1] === volunteerId) {
            sheet.deleteRow(i + 1);
            return { success: true };
        }
    }

    return { success: false, error: 'Hours entry not found' };
}

// ========================================
// Shifts Management
// ========================================

function saveShift(shiftData) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Shifts');
    if (!sheet) return { success: false, error: 'Shifts sheet not found' };

    const data = sheet.getDataRange().getValues();

    // Find existing shift by ID
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === shiftData.id) {
            rowIndex = i + 1;
            break;
        }
    }

    const rowData = [
        shiftData.id,
        shiftData.date,
        shiftData.startTime,
        shiftData.endTime,
        shiftData.volunteersNeeded,
        shiftData.description || '',
        shiftData.breakStart || '',
        shiftData.breakEnd || '',
        JSON.stringify(shiftData.applicants || []),
        shiftData.createdAt || new Date().toISOString()
    ];

    if (rowIndex > 0) {
        sheet.getRange(rowIndex, 1, 1, 10).setValues([rowData]);
    } else {
        sheet.appendRow(rowData);
    }

    return { success: true, id: shiftData.id };
}

function deleteShift(id) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Shifts');
    if (!sheet) return { success: false, error: 'Shifts sheet not found' };

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === id) {
            sheet.deleteRow(i + 1);
            return { success: true };
        }
    }

    return { success: false, error: 'Shift not found' };
}

function applyForShift(shiftId, volunteerId, notes) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shiftsSheet = ss.getSheetByName('Shifts');
    const volunteersSheet = ss.getSheetByName('Volunteers');

    if (!shiftsSheet || !volunteersSheet) {
        return { success: false, error: 'Required sheets not found' };
    }

    // Get volunteer name
    const volunteersData = getSheetData(volunteersSheet);
    const volunteer = volunteersData.find(v => v.ID === volunteerId);
    if (!volunteer) {
        return { success: false, error: 'Volunteer not found' };
    }

    // Get shift
    const shiftsData = shiftsSheet.getDataRange().getValues();
    let rowIndex = -1;
    let applicants = [];

    for (let i = 1; i < shiftsData.length; i++) {
        if (shiftsData[i][0] === shiftId) {
            rowIndex = i + 1;
            applicants = shiftsData[i][8] ? JSON.parse(shiftsData[i][8]) : [];
            break;
        }
    }

    if (rowIndex < 0) {
        return { success: false, error: 'Shift not found' };
    }

    // Check if already applied
    if (applicants.some(a => a.volunteerId === volunteerId)) {
        return { success: false, error: 'This volunteer has already applied for this shift.' };
    }

    // Add applicant
    applicants.push({
        volunteerId: volunteerId,
        volunteerName: volunteer.Name,
        notes: notes || '',
        appliedAt: new Date().toISOString()
    });

    // Save back
    shiftsSheet.getRange(rowIndex, 9).setValue(JSON.stringify(applicants));

    return { success: true };
}

function removeApplicant(shiftId, volunteerId) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Shifts');
    if (!sheet) return { success: false, error: 'Shifts sheet not found' };

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === shiftId) {
            let applicants = data[i][8] ? JSON.parse(data[i][8]) : [];
            applicants = applicants.filter(a => a.volunteerId !== volunteerId);
            sheet.getRange(i + 1, 9).setValue(JSON.stringify(applicants));
            return { success: true };
        }
    }

    return { success: false, error: 'Shift not found' };
}

// ========================================
// Manager Management
// ========================================

function addManager(email, adminEmail) {
    // Verify requester is admin
    const loginCheck = managerLogin(adminEmail);
    if (!loginCheck.success) {
        return { success: false, error: 'Only managers can add other managers.' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Managers');
    if (!sheet) return { success: false, error: 'Managers sheet not found' };

    // Check if already exists
    const data = getSheetData(sheet);
    if (data.some(m => m.Email && m.Email.toLowerCase().trim() === email.toLowerCase().trim())) {
        return { success: false, error: 'This email is already a manager.' };
    }

    sheet.appendRow([email, new Date().toISOString()]);

    return { success: true };
}

function removeManager(email, adminEmail) {
    // Verify requester is admin
    const loginCheck = managerLogin(adminEmail);
    if (!loginCheck.success) {
        return { success: false, error: 'Only managers can remove other managers.' };
    }

    // Can't remove yourself
    if (email.toLowerCase().trim() === adminEmail.toLowerCase().trim()) {
        return { success: false, error: 'You cannot remove yourself as a manager.' };
    }

    // Can't remove initial admin
    if (email.toLowerCase().trim() === INITIAL_ADMIN_EMAIL.toLowerCase().trim()) {
        return { success: false, error: 'Cannot remove the primary administrator.' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Managers');
    if (!sheet) return { success: false, error: 'Managers sheet not found' };

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toLowerCase().trim() === email.toLowerCase().trim()) {
            sheet.deleteRow(i + 1);
            return { success: true };
        }
    }

    return { success: false, error: 'Manager not found' };
}

// ========================================
// Shift Review System
// ========================================

function getPendingReviews() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shiftsSheet = ss.getSheetByName('Shifts');
    const volunteersSheet = ss.getSheetByName('Volunteers');

    if (!shiftsSheet) return { success: false, error: 'Shifts sheet not found' };

    const shiftsData = getSheetData(shiftsSheet);
    const volunteersData = volunteersSheet ? getSheetData(volunteersSheet) : [];
    const now = new Date();

    const pendingShifts = [];

    for (const shift of shiftsData) {
        // Skip already reviewed shifts
        if (shift.Reviewed === true || shift.Reviewed === 'true' || shift.Reviewed === 'TRUE') {
            continue;
        }

        // Parse shift date and end time
        const shiftDate = parseShiftDate(shift.Date);
        if (!shiftDate) continue;

        const endTime = normalizeTimeValue(shift.EndTime);
        if (!endTime) continue;

        // Combine date and end time
        const [hours, mins] = endTime.split(':').map(Number);
        const shiftEndDateTime = new Date(shiftDate);
        shiftEndDateTime.setHours(hours, mins, 0, 0);

        // Only include shifts that have ended
        if (shiftEndDateTime < now) {
            // Get applicant details
            const applicants = shift.Applicants ? JSON.parse(shift.Applicants) : [];
            const applicantsWithDetails = applicants.map(app => {
                const volunteer = volunteersData.find(v => v.ID === app.volunteerId);
                return {
                    volunteerId: app.volunteerId,
                    volunteerName: volunteer ? volunteer.Name : app.volunteerName || 'Unknown',
                    notes: app.notes || ''
                };
            });

            pendingShifts.push({
                id: shift.ShiftID,
                date: formatDateForDisplay(shift.Date),
                rawDate: shift.Date,
                startTime: shift.StartTime,
                endTime: shift.EndTime,
                breakStart: shift.BreakStart || null,
                breakEnd: shift.BreakEnd || null,
                description: shift.Description || '',
                applicants: applicantsWithDetails
            });
        }
    }

    return { success: true, pendingShifts: pendingShifts };
}

function parseShiftDate(dateVal) {
    if (!dateVal) return null;

    // If it's already a Date object
    if (dateVal instanceof Date) {
        return dateVal;
    }

    // If it's a string, try to parse it
    if (typeof dateVal === 'string') {
        // Try ISO format first
        let parsed = new Date(dateVal);
        if (!isNaN(parsed.getTime())) return parsed;

        // Try DD/MM/YYYY format
        const parts = dateVal.split(/[\/\-]/);
        if (parts.length === 3) {
            // Assume DD/MM/YYYY
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1;
            const year = parseInt(parts[2]);
            return new Date(year, month, day);
        }
    }

    return null;
}

function formatDateForDisplay(dateVal) {
    const date = parseShiftDate(dateVal);
    if (!date) return dateVal;

    const day = date.getDate();
    const month = date.toLocaleString('en-AU', { month: 'short' });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
}

// Normalize date to YYYY-MM-DD format for consistent comparison
function normalizeDate(dateVal) {
    if (!dateVal) return '';

    // If it's already a Date object
    if (dateVal instanceof Date) {
        const d = dateVal;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // If it's a string
    const dateStr = String(dateVal);

    // If already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }

    // Try to parse and convert
    const parsed = parseShiftDate(dateVal);
    if (parsed) {
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    return dateStr;
}

function submitShiftReview(reviewData) {
    // reviewData = { shiftId, attendees: [{ volunteerId, checkIn, checkOut, breakStart, breakEnd }] }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shiftsSheet = ss.getSheetByName('Shifts');
    const hoursSheet = ss.getSheetByName('Hours');

    if (!shiftsSheet || !hoursSheet) {
        return { success: false, error: 'Required sheets not found' };
    }

    // Find the shift
    const shiftsData = shiftsSheet.getDataRange().getValues();
    const headers = shiftsData[0];
    let shiftRowIndex = -1;
    let shiftDate = null;

    // Find column indices
    const reviewedColIndex = headers.indexOf('Reviewed');
    const dateColIndex = headers.indexOf('Date');

    for (let i = 1; i < shiftsData.length; i++) {
        if (shiftsData[i][0] === reviewData.shiftId) {
            shiftRowIndex = i + 1; // 1-indexed for sheet operations
            shiftDate = shiftsData[i][dateColIndex];
            break;
        }
    }

    if (shiftRowIndex < 0) {
        return { success: false, error: 'Shift not found' };
    }

    // Format the date for hours entries
    const formattedDate = formatDateForHours(shiftDate);

    // Save hours for each attendee
    const savedHours = [];
    for (const attendee of reviewData.attendees) {
        const hoursEntry = {
            id: generateUUID(),
            volunteerId: attendee.volunteerId,
            date: formattedDate,
            checkIn: attendee.checkIn,
            checkOut: attendee.checkOut,
            breakStart: attendee.breakStart || '',
            breakEnd: attendee.breakEnd || ''
        };

        const result = saveHours(hoursEntry);
        if (result.success) {
            savedHours.push(hoursEntry);
        }
    }

    // Mark shift as reviewed
    if (reviewedColIndex >= 0) {
        shiftsSheet.getRange(shiftRowIndex, reviewedColIndex + 1).setValue('true');
    } else {
        // If Reviewed column doesn't exist, add it
        const lastCol = headers.length + 1;
        shiftsSheet.getRange(1, lastCol).setValue('Reviewed');
        shiftsSheet.getRange(shiftRowIndex, lastCol).setValue('true');
    }

    return {
        success: true,
        hoursLogged: savedHours.length,
        message: `Successfully logged hours for ${savedHours.length} volunteer(s)`
    };
}

function formatDateForHours(dateVal) {
    const date = parseShiftDate(dateVal);
    if (!date) return dateVal;

    // Return in YYYY-MM-DD format for consistency
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
