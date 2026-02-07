// ========================================
// Volunteer Hours Tracker - Main Application
// ========================================

// Data storage key
const STORAGE_KEY = 'volunteerHoursData';

// Application state
let appData = {
    volunteers: [],
    shifts: []
};

// Search state
let currentSearchTerm = '';

// ========================================
// Double-Click Prevention Utility
// ========================================

// Prevents double-clicks on async operations by disabling button during execution
async function preventDoubleClick(button, asyncOperation) {
    if (!button || button.disabled) return;

    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="loader-spinner-small"></span> ' + button.textContent.trim() + '...';

    try {
        await asyncOperation();
    } finally {
        button.disabled = false;
        button.innerHTML = originalHTML;
    }
}

// ========================================
// Excel Import with Intelligent Column Detection
// ========================================

async function importFromExcel(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet || worksheet.rowCount < 2) {
            alert('No data found in the Excel file.');
            return;
        }

        // Detect if this is a backup file exported by this app
        const volunteerHoursSheet = workbook.getWorksheet('Volunteer Hours');
        if (volunteerHoursSheet) {
            // Check for exact export headers
            const headerRow = volunteerHoursSheet.getRow(1);
            const exportHeaders = ['name', 'phone', 'email', 'address', 'suburb', 'emergency contact', 'date', 'check in', 'check out', 'hours worked'];
            let matchCount = 0;
            headerRow.eachCell((cell) => {
                const cellValue = cell.value ? cell.value.toString().toLowerCase().trim() : '';
                if (exportHeaders.includes(cellValue)) {
                    matchCount++;
                }
            });
            // If most headers match, it's a backup file
            if (matchCount >= 6) {
                alert('⚠️ This appears to be a backup file exported from this app.\n\nPlease use the "Restore Backup" button instead of "Import Excel" to restore your data correctly.');
                return;
            }
        }

        // Smart header detection: Scan first 15 rows to find the best header row
        let bestHeaderRow = 1;
        let bestScore = 0;
        let bestColumns = null;

        const maxScanRows = Math.min(15, worksheet.rowCount);

        for (let rowNum = 1; rowNum <= maxScanRows; rowNum++) {
            const row = worksheet.getRow(rowNum);
            const headers = [];

            row.eachCell((cell, colNumber) => {
                headers[colNumber] = cell.value ? cell.value.toString().toLowerCase().trim() : '';
            });

            // Score this row based on how many column keywords it matches
            const cols = detectColumns(headers);
            let score = 0;

            if (cols.firstName) score += 2;
            if (cols.lastName) score += 2;
            if (cols.fullName) score += 3;
            if (cols.phone) score += 1;
            if (cols.email) score += 1;

            console.log(`Row ${rowNum}:`, headers.filter(h => h), `Score: ${score}`);

            if (score > bestScore) {
                bestScore = score;
                bestHeaderRow = rowNum;
                bestColumns = cols;
            }
        }

        console.log(`Best header row: ${bestHeaderRow}, Score: ${bestScore}`);

        if (!bestColumns || (!bestColumns.firstName && !bestColumns.fullName)) {
            alert(`Could not find name columns.\n\nScanned first ${maxScanRows} rows but couldn't find "First Name", "Last Name", "Name", etc.`);
            return;
        }

        const columns = bestColumns;

        // Import each row as a volunteer
        let importCount = 0;
        let mergeCount = 0;
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber <= bestHeaderRow) return; // Skip header row and rows before it

            // Extract name
            let name = '';
            if (columns.fullName) {
                name = getCellValue(row.getCell(columns.fullName));
            } else {
                const firstName = getCellValue(row.getCell(columns.firstName)) || '';
                const lastName = getCellValue(row.getCell(columns.lastName)) || '';
                name = `${firstName} ${lastName}`.trim();
            }

            if (!name) return; // Skip rows without a name

            // Deduplicate repeated names (e.g., "Tom Peacock Tom Peacock" -> "Tom Peacock")
            const nameWords = name.split(/\s+/);
            if (nameWords.length >= 4) {
                const half = Math.floor(nameWords.length / 2);
                const firstHalf = nameWords.slice(0, half).join(' ');
                const secondHalf = nameWords.slice(half).join(' ');
                if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
                    name = firstHalf; // Use just the first half
                }
            }

            // Extract all contact info
            const phone = columns.phone ? getCellValue(row.getCell(columns.phone)) : '';
            const email = columns.email ? getCellValue(row.getCell(columns.email)) : '';
            const address = columns.address ? getCellValue(row.getCell(columns.address)) : '';
            const suburb = columns.suburb ? getCellValue(row.getCell(columns.suburb)) : '';
            let emergencyContact = columns.emergencyContact ? getCellValue(row.getCell(columns.emergencyContact)) : '';

            // Validate Emergency Contact - must be DIFFERENT from volunteer's own info
            if (emergencyContact) {
                const normalizedEC = emergencyContact.toLowerCase().trim();
                const normalizedName = name.toLowerCase().trim();
                // If emergency contact is same as volunteer's name or phone, it's invalid
                if (normalizedEC === normalizedName || emergencyContact === phone) {
                    emergencyContact = ''; // Will default to N/A
                }
            }

            // Smart duplicate detection - find existing volunteer by name
            let existing = appData.volunteers.find(v =>
                v.name.toLowerCase() === name.toLowerCase()
            );

            // If same name found, check if it's truly the same person using secondary identifiers
            if (existing && (phone || email)) {
                // If existing has phone/email and new data has different ones, might be different person
                const existingPhone = existing.phone !== 'N/A' ? existing.phone : '';
                const existingEmail = existing.email !== 'N/A' ? existing.email : '';

                if (existingPhone && phone && existingPhone !== phone &&
                    existingEmail && email && existingEmail !== email) {
                    // Different phone AND email = likely different person with same name
                    existing = null;
                }
            }

            if (existing) {
                // Merge new data into existing volunteer (fill in missing fields)
                let updated = false;
                if (phone && (existing.phone === 'N/A' || !existing.phone)) {
                    existing.phone = phone;
                    updated = true;
                }
                if (email && (existing.email === 'N/A' || !existing.email)) {
                    existing.email = email;
                    updated = true;
                }
                if (address && (existing.address === 'N/A' || !existing.address)) {
                    existing.address = address;
                    updated = true;
                }
                if (suburb && (existing.suburb === 'N/A' || !existing.suburb)) {
                    existing.suburb = suburb;
                    updated = true;
                }
                if (emergencyContact && (existing.emergencyContact === 'N/A' || !existing.emergencyContact)) {
                    existing.emergencyContact = emergencyContact;
                    updated = true;
                }
                if (updated) {
                    mergeCount++;
                }
            } else {
                // New volunteer
                addVolunteer(name, phone, email, address, suburb, emergencyContact);
                importCount++;
            }
        });

        saveData();
        renderVolunteers();
        updateStats();
        updateVolunteerCount();

        // Sync all volunteers to cloud (bulk sync)
        syncAllVolunteersToCloud();

        // Sync all hours to cloud (bulk sync)
        syncAllHoursToCloud();

        let message = `Import complete!\n\n${importCount} new volunteer(s) added.`;
        if (mergeCount > 0) {
            message += `\n${mergeCount} existing profile(s) updated with new data.`;
        }
        message += `\n\nHeader row detected: Row ${bestHeaderRow}`;
        message += '\n\nSyncing to cloud in background...';
        alert(message);

    } catch (error) {
        console.error('Error importing Excel:', error);
        alert('Error reading the Excel file. Please ensure it is a valid .xlsx file.');
    }
}

// ========================================
// Restore from Exported Backup
// ========================================

async function restoreFromBackup(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);

        // Look for "Volunteer Hours" sheet (our export format)
        let worksheet = workbook.getWorksheet('Volunteer Hours');
        if (!worksheet) {
            // Try first sheet if named sheet not found
            worksheet = workbook.worksheets[0];
        }

        if (!worksheet || worksheet.rowCount < 2) {
            alert('No data found in the backup file.');
            return;
        }

        // Verify this is our export format by checking headers
        const headerRow = worksheet.getRow(1);
        const headers = [];
        headerRow.eachCell((cell, colNumber) => {
            headers[colNumber] = cell.value ? cell.value.toString().toLowerCase().trim() : '';
        });

        // Find column indices for our export format
        let nameCol = null, phoneCol = null, emailCol = null;
        let dateCol = null, checkInCol = null, checkOutCol = null;

        headers.forEach((h, index) => {
            if (h === 'name') nameCol = index;
            if (h === 'phone') phoneCol = index;
            if (h === 'email') emailCol = index;
            if (h === 'date') dateCol = index;
            if (h === 'check in') checkInCol = index;
            if (h === 'check out') checkOutCol = index;
        });

        if (!nameCol) {
            alert('This does not appear to be a valid backup file exported from this app.\n\nPlease use an Excel file that was exported using the "Export to Excel" button.');
            return;
        }

        // Confirm with user before restoring
        const currentCount = appData.volunteers.length;
        if (currentCount > 0) {
            const confirmed = confirm(`Warning: You currently have ${currentCount} volunteer(s) in the system.\n\nRestoring from backup will MERGE the backup data with existing data (duplicates by name will be skipped).\n\nDo you want to continue?`);
            if (!confirmed) return;
        }

        // Build volunteer data from rows
        const volunteersMap = new Map(); // name -> volunteer object

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            const name = getCellValue(row.getCell(nameCol));
            if (!name) return;

            const phone = phoneCol ? getCellValue(row.getCell(phoneCol)) : 'N/A';
            const email = emailCol ? getCellValue(row.getCell(emailCol)) : 'N/A';
            const date = dateCol ? getCellValue(row.getCell(dateCol)) : '';
            const checkIn = checkInCol ? getCellValue(row.getCell(checkInCol)) : '';
            const checkOut = checkOutCol ? getCellValue(row.getCell(checkOutCol)) : '';

            // Get or create volunteer
            if (!volunteersMap.has(name.toLowerCase())) {
                // Check if already exists in current data
                const existing = appData.volunteers.find(v => v.name.toLowerCase() === name.toLowerCase());
                if (existing) {
                    volunteersMap.set(name.toLowerCase(), existing);
                } else {
                    const newVolunteer = {
                        id: generateId(),
                        name: name,
                        phone: phone || 'N/A',
                        email: email || 'N/A',
                        hours: []
                    };
                    volunteersMap.set(name.toLowerCase(), newVolunteer);
                    appData.volunteers.push(newVolunteer);
                }
            }

            // Add hours entry if we have date/time data
            if (date && checkIn && checkOut) {
                const volunteer = volunteersMap.get(name.toLowerCase());

                // Convert time format if needed (e.g., "9:00 AM" -> "09:00")
                const normalizedCheckIn = normalizeTime(checkIn);
                const normalizedCheckOut = normalizeTime(checkOut);
                const normalizedDate = normalizeDate(date);

                if (normalizedCheckIn && normalizedCheckOut && normalizedDate) {
                    // Check for duplicate entry
                    const isDuplicate = volunteer.hours.some(h =>
                        h.date === normalizedDate &&
                        h.checkIn === normalizedCheckIn &&
                        h.checkOut === normalizedCheckOut
                    );

                    if (!isDuplicate) {
                        volunteer.hours.push({
                            id: generateId(),
                            date: normalizedDate,
                            checkIn: normalizedCheckIn,
                            checkOut: normalizedCheckOut
                        });
                    }
                }
            }
        });

        saveData();
        renderVolunteers();
        updateStats();
        updateVolunteerCount();

        // Sync restored data to cloud
        syncAllVolunteersToCloud();
        syncAllHoursToCloud();

        const restoredCount = volunteersMap.size;
        let message = `Backup restored successfully!\n\n${restoredCount} volunteer(s) processed from backup.`;
        message += '\n\nSyncing to cloud in background...';
        alert(message);

    } catch (error) {
        console.error('Error restoring backup:', error);
        alert('Error reading the backup file. Please ensure it is a valid .xlsx file exported from this app.');
    }
}

// Helper to normalize time formats (e.g., "9:00 AM" -> "09:00")
function normalizeTime(timeStr) {
    if (!timeStr) return null;

    // Already in 24h format (HH:MM)
    if (/^\d{2}:\d{2}$/.test(timeStr)) {
        return timeStr;
    }

    // 12h format with AM/PM
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (match) {
        let hours = parseInt(match[1]);
        const minutes = match[2];
        const period = match[3];

        if (period) {
            if (period.toUpperCase() === 'PM' && hours !== 12) hours += 12;
            if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
        }

        return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }

    return null;
}

// Helper to normalize date formats
function normalizeDate(dateStr) {
    if (!dateStr) return null;

    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }

    // Try to parse various date formats
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
    }

    // DD/MM/YYYY format
    const dmyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
        const day = dmyMatch[1].padStart(2, '0');
        const month = dmyMatch[2].padStart(2, '0');
        const year = dmyMatch[3];
        return `${year}-${month}-${day}`;
    }

    return null;
}

function detectColumns(headers) {
    const columns = {
        firstName: null,
        lastName: null,
        fullName: null,
        phone: null,
        email: null,
        address: null,
        suburb: null,
        emergencyContact: null
    };

    // Comprehensive keyword synonyms for each field type
    const FIRST_NAME_KEYWORDS = [
        'first name', 'firstname', 'first_name', 'fname', 'f name',
        'given name', 'givenname', 'given_name', 'given',
        'forename', 'fore name', 'christian name',
        'preferred name', 'preferredname'
    ];

    const LAST_NAME_KEYWORDS = [
        'last name', 'lastname', 'last_name', 'lname', 'l name',
        'surname', 'sur name', 'sur_name',
        'family name', 'familyname', 'family_name', 'family',
        'second name', 'secondname'
    ];

    const FULL_NAME_KEYWORDS = [
        'full name', 'fullname', 'full_name',
        'name', 'volunteer name', 'volunteername', 'volunteer_name',
        'member name', 'membername', 'member_name',
        'person name', 'personname', 'person_name',
        'participant name', 'participantname', 'participant_name',
        'student name', 'studentname', 'student_name',
        'display name', 'displayname', 'display_name'
    ];

    const PHONE_KEYWORDS = [
        'phone', 'phone number', 'phonenumber', 'phone_number', 'phone no', 'phone #',
        'mobile', 'mobile number', 'mobilenumber', 'mobile_number', 'mobile no', 'mobile #',
        'cell', 'cell phone', 'cellphone', 'cell_phone', 'cellular',
        'telephone', 'tel', 'tel no', 'tel number', 'tel#',
        'contact number', 'contactnumber', 'contact_number', 'contact no',
        'ph', 'ph#', 'mob', 'mob#',
        'home phone', 'homephone', 'home_phone',
        'work phone', 'workphone', 'work_phone',
        'primary phone', 'primaryphone', 'primary_phone'
    ];

    // Keywords that should NOT match as phone
    const PHONE_EXCLUSIONS = ['address', 'street', 'suburb', 'city', 'postcode', 'zip', 'emergency', 'kin', 'ice', 'contact 2', 'secondary', 'alternate'];

    const EMAIL_KEYWORDS = [
        'email', 'e-mail', 'e mail', 'email address', 'emailaddress', 'email_address',
        'contact email', 'contactemail', 'contact_email',
        'primary email', 'primaryemail', 'primary_email',
        'work email', 'workemail', 'work_email',
        'personal email', 'personalemail', 'personal_email',
        'email id', 'emailid', 'email_id'
    ];

    // Keywords that should NOT match as email (home address, mailing address, etc.)
    const EMAIL_EXCLUSIONS = [
        'home address', 'street address', 'mailing address', 'postal address',
        'residential address', 'physical address', 'business address', 'work address'
    ];

    // If header is JUST "address" without "email" prefix, it's not email
    const ADDRESS_ONLY_KEYWORDS = ['address', 'addr', 'street', 'suburb', 'city', 'postcode', 'zip', 'state'];

    // Address keywords (physical address, NOT email address)
    const ADDRESS_KEYWORDS = [
        'address', 'home address', 'street address', 'residential address',
        'physical address', 'mailing address', 'postal address',
        'street', 'street name', 'addr', 'location'
    ];

    // Suburb/City keywords
    const SUBURB_KEYWORDS = [
        'suburb', 'city', 'town', 'locality', 'area', 'district',
        'suburb/city', 'city/suburb', 'suburb/town'
    ];

    // Emergency Contact keywords (NOT just "contact" which could mean phone)
    const EMERGENCY_CONTACT_KEYWORDS = [
        'emergency contact', 'emergencycontact', 'emergency_contact',
        'emergency', 'emergency phone', 'emergency number',
        'next of kin', 'nextofkin', 'next_of_kin', 'nok',
        'ice contact', 'ice', 'in case of emergency',
        'emergency name', 'emergency person',
        'contact 2', 'secondary contact', 'alternate contact',
        'parent', 'guardian', 'mother', 'father',
        'spouse', 'partner', 'husband', 'wife'
    ];

    // Helper function to check if header matches any keyword
    function matchesAny(header, keywords) {
        const normalizedHeader = header.toLowerCase().trim();
        return keywords.some(keyword =>
            normalizedHeader === keyword ||
            normalizedHeader.includes(keyword) ||
            keyword.includes(normalizedHeader)
        );
    }

    headers.forEach((header, index) => {
        if (!header) return;
        const h = header.toLowerCase().trim();

        // Full Name detection (check first to prioritize)
        if (!columns.fullName && matchesAny(h, FULL_NAME_KEYWORDS)) {
            // But not if it's clearly first or last name
            if (!matchesAny(h, FIRST_NAME_KEYWORDS) && !matchesAny(h, LAST_NAME_KEYWORDS)) {
                columns.fullName = index;
            }
        }

        // First Name detection (but not if already used for fullName)
        if (!columns.firstName && matchesAny(h, FIRST_NAME_KEYWORDS)) {
            if (index !== columns.fullName) {
                columns.firstName = index;
            }
        }

        // Last Name detection (but not if already used for fullName)
        if (!columns.lastName && matchesAny(h, LAST_NAME_KEYWORDS)) {
            if (index !== columns.fullName) {
                columns.lastName = index;
            }
        }

        // Phone detection - but exclude address-related columns
        if (!columns.phone && matchesAny(h, PHONE_KEYWORDS)) {
            // Make sure it's not an address column
            const isAddress = PHONE_EXCLUSIONS.some(ex => h.includes(ex));
            if (!isAddress) {
                columns.phone = index;
            }
        }

        // Email detection - must contain 'email' or 'e-mail', not just 'address' or 'mail'
        if (!columns.email) {
            // Check if it's an email column
            const hasEmailKeyword = h.includes('email') || h.includes('e-mail') || h.includes('e mail');

            // Make sure it's NOT just a physical address column
            const isPhysicalAddress = ADDRESS_ONLY_KEYWORDS.some(addr => {
                // If header is just "address" or starts with address-related term without "email"
                return (h === addr || h.startsWith(addr + ' ') || h.endsWith(' ' + addr)) && !hasEmailKeyword;
            });

            // Also check explicit exclusions
            const isExcluded = EMAIL_EXCLUSIONS.some(ex => h.includes(ex));

            if (hasEmailKeyword && !isPhysicalAddress && !isExcluded) {
                columns.email = index;
            }
        }

        // Address detection (physical address, NOT email address)
        if (!columns.address && matchesAny(h, ADDRESS_KEYWORDS)) {
            // Make sure it's NOT an email address column
            const isEmail = h.includes('email') || h.includes('e-mail');
            if (!isEmail) {
                columns.address = index;
            }
        }

        // Suburb detection
        if (!columns.suburb && matchesAny(h, SUBURB_KEYWORDS)) {
            columns.suburb = index;
        }

        // Emergency Contact detection (NOT just "contact")
        if (!columns.emergencyContact && matchesAny(h, EMERGENCY_CONTACT_KEYWORDS)) {
            columns.emergencyContact = index;
        }
    });

    return columns;
}

function getCellValue(cell) {
    if (!cell || !cell.value) return '';
    const value = cell.value;
    if (typeof value === 'object') {
        return value.text || value.result || String(value);
    }
    return String(value).trim();
}

// ========================================
// Search and Filter
// ========================================

function filterVolunteers(searchTerm) {
    currentSearchTerm = searchTerm.toLowerCase().trim();
    renderVolunteers();
    updateVolunteerCount();
}

function updateVolunteerCount() {
    const total = appData.volunteers.length;
    const displayed = getFilteredVolunteers().length;
    const countElement = document.getElementById('volunteerCount');

    if (currentSearchTerm) {
        countElement.textContent = `Showing ${displayed} of ${total} volunteers`;
    } else {
        countElement.textContent = `${total} volunteer${total !== 1 ? 's' : ''}`;
    }
}

function getFilteredVolunteers() {
    if (!currentSearchTerm) {
        return appData.volunteers;
    }
    return appData.volunteers.filter(v =>
        v.name.toLowerCase().includes(currentSearchTerm)
    );
}

// ========================================
// Data Management
// ========================================

function loadData() {
    // Try localStorage first for immediate display
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            appData = JSON.parse(stored);
        } catch (e) {
            console.error('Error loading data:', e);
            appData = { volunteers: [], shifts: [] };
        }
    }
}

function saveData() {
    // Save to localStorage for offline/immediate access
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

// Cloud sync functions - call these after local save for important data
async function syncVolunteerToCloud(volunteer) {
    try {
        const success = await saveVolunteerToCloud(volunteer);
        if (!success) {
            console.error('Failed to sync volunteer to cloud');
        }
        return success;
    } catch (e) {
        console.error('Cloud sync error:', e);
        return false;
    }
}

async function syncHoursToCloud(hoursData) {
    try {
        const success = await saveHoursToCloud(hoursData);
        if (!success) {
            console.error('Failed to sync hours to cloud');
        }
        return success;
    } catch (e) {
        console.error('Cloud sync error:', e);
        return false;
    }
}

async function syncShiftToCloud(shift) {
    try {
        const success = await saveShiftToCloud(shift);
        if (!success) {
            console.error('Failed to sync shift to cloud');
        }
        return success;
    } catch (e) {
        console.error('Cloud sync error:', e);
        return false;
    }
}

// Bulk sync all volunteers to cloud (used after Excel import)
async function syncAllVolunteersToCloud() {
    console.log('=== Starting bulk sync of all volunteers to cloud ===');
    console.log('Total volunteers in app:', appData.volunteers.length);

    let successCount = 0;
    let failCount = 0;
    const failedVolunteers = [];

    for (let i = 0; i < appData.volunteers.length; i++) {
        const volunteer = appData.volunteers[i];
        try {
            // Check for missing id or name
            if (!volunteer.id || !volunteer.name) {
                console.warn(`[${i + 1}] SKIPPED - Missing id or name:`, JSON.stringify(volunteer));
                failedVolunteers.push({ index: i + 1, name: volunteer.name || '(empty)', reason: 'missing id or name' });
                failCount++;
                continue;
            }

            const success = await saveVolunteerToCloud(volunteer);
            if (success) {
                successCount++;
            } else {
                console.error(`[${i + 1}] FAILED: ${volunteer.name} - API returned false`);
                failedVolunteers.push({ index: i + 1, name: volunteer.name, reason: 'API returned false' });
                failCount++;
            }
        } catch (e) {
            console.error(`[${i + 1}] ERROR: ${volunteer.name}:`, e);
            failedVolunteers.push({ index: i + 1, name: volunteer.name, reason: e.message || e.toString() });
            failCount++;
        }
    }

    console.log(`=== Bulk sync complete: ${successCount} succeeded, ${failCount} failed ===`);
    if (failedVolunteers.length > 0) {
        console.error('Failed volunteers:', JSON.stringify(failedVolunteers, null, 2));
        alert(`Warning: ${failCount} volunteer(s) failed to sync:\n${failedVolunteers.map(f => `${f.index}. ${f.name}: ${f.reason}`).join('\n')}`);
    }

    // Update last synced time
    const lastUpdatedEl = document.getElementById('lastUpdated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `Synced: ${successCount}/${appData.volunteers.length}`;
    }
}

// Bulk sync all hours to cloud (used after Excel import)
async function syncAllHoursToCloud() {
    console.log('Starting bulk sync of all hours to cloud...');
    let successCount = 0;
    let failCount = 0;

    for (const volunteer of appData.volunteers) {
        if (volunteer.hours && volunteer.hours.length > 0) {
            for (const entry of volunteer.hours) {
                try {
                    const success = await saveHoursToCloud({
                        id: entry.id,
                        volunteerId: volunteer.id,
                        date: entry.date,
                        checkIn: entry.checkIn,
                        checkOut: entry.checkOut,
                        breakStart: entry.breakStart,
                        breakEnd: entry.breakEnd
                    });
                    if (success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (e) {
                    console.error('Error syncing hours entry:', e);
                    failCount++;
                }
            }
        }
    }

    console.log(`Bulk hours sync complete: ${successCount} succeeded, ${failCount} failed`);
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// ========================================
// Volunteer Management
// ========================================

async function addVolunteer(name, phone, email, address, suburb, emergencyContact) {
    const volunteer = {
        id: generateId(),
        name: name.trim(),
        phone: phone.trim() || 'N/A',
        email: email.trim() || 'N/A',
        address: address ? address.trim() || 'N/A' : 'N/A',
        suburb: suburb ? suburb.trim() || 'N/A' : 'N/A',
        emergencyContact: emergencyContact ? emergencyContact.trim() || 'N/A' : 'N/A',
        hours: []
    };
    appData.volunteers.push(volunteer);
    saveData();

    // Sync to Google Sheets
    await syncVolunteerToCloud(volunteer);

    return volunteer;
}

async function deleteVolunteer(volunteerId) {
    appData.volunteers = appData.volunteers.filter(v => v.id !== volunteerId);
    saveData();

    // Sync deletion to cloud
    await deleteVolunteerFromCloud(volunteerId);
}

function getVolunteer(volunteerId) {
    return appData.volunteers.find(v => v.id === volunteerId);
}

async function updateVolunteer(volunteerId, name, phone, email, address, suburb, emergencyContact) {
    const volunteer = getVolunteer(volunteerId);
    if (!volunteer) return null;

    volunteer.name = name.trim();
    volunteer.phone = phone.trim() || 'N/A';
    volunteer.email = email.trim() || 'N/A';
    volunteer.address = address ? address.trim() || 'N/A' : 'N/A';
    volunteer.suburb = suburb ? suburb.trim() || 'N/A' : 'N/A';
    volunteer.emergencyContact = emergencyContact ? emergencyContact.trim() || 'N/A' : 'N/A';
    saveData();

    // Sync to Google Sheets
    await syncVolunteerToCloud(volunteer);

    return volunteer;
}

// ========================================
// Hours Management
// ========================================

async function addHoursEntry(volunteerId, date, checkIn, checkOut, breakStart = null, breakEnd = null) {
    const volunteer = getVolunteer(volunteerId);
    if (!volunteer) return null;

    const entry = {
        id: generateId(),
        date,
        checkIn,
        checkOut,
        breakStart: breakStart || null,
        breakEnd: breakEnd || null
    };
    volunteer.hours.push(entry);
    saveData();

    // Sync to Google Sheets
    await syncHoursToCloud({
        id: entry.id,
        volunteerId: volunteerId,
        date: entry.date,
        checkIn: entry.checkIn,
        checkOut: entry.checkOut,
        breakStart: entry.breakStart,
        breakEnd: entry.breakEnd
    });

    return entry;
}

async function deleteHoursEntry(volunteerId, entryId) {
    const volunteer = getVolunteer(volunteerId);
    if (!volunteer) return;

    volunteer.hours = volunteer.hours.filter(h => h.id !== entryId);
    saveData();

    // Sync deletion to cloud
    await deleteHoursFromCloud(volunteerId, entryId);
}

function calculateHours(checkIn, checkOut, breakStart = null, breakEnd = null) {
    // Helper to parse time value (handles various formats)
    const parseTime = (timeVal) => {
        if (!timeVal && timeVal !== 0) return { hour: 0, min: 0, valid: false };

        // If it's a string with colon (e.g., "09:00" or "9:00 AM")
        if (typeof timeVal === 'string' && timeVal.includes(':')) {
            // Remove AM/PM and parse
            let cleanTime = timeVal.toUpperCase().trim();
            const isPM = cleanTime.includes('PM');
            const isAM = cleanTime.includes('AM');
            cleanTime = cleanTime.replace(/\s*(AM|PM)\s*/gi, '').trim();

            const parts = cleanTime.split(':').map(Number);
            let hour = parts[0] || 0;
            const min = parts[1] || 0;

            // Convert 12-hour to 24-hour if AM/PM present
            if (isPM && hour !== 12) hour += 12;
            if (isAM && hour === 12) hour = 0;

            return { hour, min, valid: true };
        }

        // If it's a Date object or ISO string
        if (timeVal instanceof Date || (typeof timeVal === 'string' && timeVal.includes('T'))) {
            const d = new Date(timeVal);
            if (!isNaN(d.getTime())) {
                return { hour: d.getHours(), min: d.getMinutes(), valid: true };
            }
        }

        // If it's a decimal number - check if it's Google Sheets format (0-1 = fraction of day)
        if (typeof timeVal === 'number') {
            // Google Sheets stores times as fractions of 24 hours
            // 0.375 = 9:00 AM, 0.5 = 12:00 PM, 0.75 = 6:00 PM
            if (timeVal >= 0 && timeVal < 1) {
                // Fraction of day format
                const totalMinutes = Math.round(timeVal * 24 * 60);
                const hour = Math.floor(totalMinutes / 60);
                const min = totalMinutes % 60;
                return { hour, min, valid: true };
            } else if (timeVal >= 1 && timeVal <= 24) {
                // Treat as hours (e.g., 9.5 = 9:30)
                const hour = Math.floor(timeVal);
                const min = Math.round((timeVal - hour) * 60);
                return { hour, min, valid: true };
            }
        }

        // Try to parse as string with just numbers
        if (typeof timeVal === 'string') {
            const cleaned = timeVal.replace(/[^\d:]/g, '');
            if (cleaned.includes(':')) {
                const parts = cleaned.split(':').map(Number);
                return { hour: parts[0] || 0, min: parts[1] || 0, valid: true };
            }
        }

        return { hour: 0, min: 0, valid: false };
    };

    const inTime = parseTime(checkIn);
    const outTime = parseTime(checkOut);

    if (!inTime.valid || !outTime.valid) {
        return 0; // Return 0 instead of NaN if invalid
    }

    const inMinutes = inTime.hour * 60 + inTime.min;
    const outMinutes = outTime.hour * 60 + outTime.min;

    let diff = outMinutes - inMinutes;
    if (diff < 0) diff += 24 * 60; // Handle overnight shifts

    // Deduct break time if present
    if (breakStart && breakEnd) {
        const bsTime = parseTime(breakStart);
        const beTime = parseTime(breakEnd);
        if (bsTime.valid && beTime.valid) {
            const breakMinutes = Math.abs((beTime.hour * 60 + beTime.min) - (bsTime.hour * 60 + bsTime.min));
            if (breakMinutes > 0) {
                diff -= breakMinutes;
            }
        }
    }

    return (diff / 60).toFixed(2);
}

function calculateBreakDuration(breakStart, breakEnd) {
    if (!breakStart || !breakEnd) return 0;

    // Helper to parse time value (same logic as calculateHours)
    const parseTime = (timeVal) => {
        if (!timeVal && timeVal !== 0) return { hour: 0, min: 0, valid: false };

        // String with colon (handle AM/PM)
        if (typeof timeVal === 'string' && timeVal.includes(':')) {
            let cleanTime = timeVal.toUpperCase().trim();
            const isPM = cleanTime.includes('PM');
            const isAM = cleanTime.includes('AM');
            cleanTime = cleanTime.replace(/\s*(AM|PM)\s*/gi, '').trim();
            const parts = cleanTime.split(':').map(Number);
            let hour = parts[0] || 0;
            const min = parts[1] || 0;
            if (isPM && hour !== 12) hour += 12;
            if (isAM && hour === 12) hour = 0;
            return { hour, min, valid: true };
        }

        // Date object or ISO string
        if (timeVal instanceof Date || (typeof timeVal === 'string' && timeVal.includes('T'))) {
            const d = new Date(timeVal);
            if (!isNaN(d.getTime())) {
                return { hour: d.getHours(), min: d.getMinutes(), valid: true };
            }
        }

        // Decimal number - Google Sheets format (0-1 = fraction of day)
        if (typeof timeVal === 'number') {
            if (timeVal >= 0 && timeVal < 1) {
                const totalMinutes = Math.round(timeVal * 24 * 60);
                const hour = Math.floor(totalMinutes / 60);
                const min = totalMinutes % 60;
                return { hour, min, valid: true };
            } else if (timeVal >= 1 && timeVal <= 24) {
                const hour = Math.floor(timeVal);
                const min = Math.round((timeVal - hour) * 60);
                return { hour, min, valid: true };
            }
        }
        return { hour: 0, min: 0, valid: false };
    };

    const bsTime = parseTime(breakStart);
    const beTime = parseTime(breakEnd);
    if (!bsTime.valid || !beTime.valid) return 0;

    const breakMinutes = (beTime.hour * 60 + beTime.min) - (bsTime.hour * 60 + bsTime.min);
    return breakMinutes > 0 ? breakMinutes : 0;
}

function getVolunteerTotalHours(volunteer) {
    if (!volunteer.hours || !Array.isArray(volunteer.hours)) return 0;
    return volunteer.hours.reduce((total, entry) => {
        const hours = parseFloat(calculateHours(entry.checkIn, entry.checkOut, entry.breakStart, entry.breakEnd));
        return total + (isNaN(hours) ? 0 : hours);
    }, 0);
}

function getVolunteerTotalBreakMinutes(volunteer) {
    if (!volunteer.hours || !Array.isArray(volunteer.hours)) return 0;
    return volunteer.hours.reduce((total, entry) => {
        return total + calculateBreakDuration(entry.breakStart, entry.breakEnd);
    }, 0);
}

// ========================================
// Shifts Management
// ========================================

async function createShift(date, startTime, endTime, volunteersNeeded, description, breakStart = null, breakEnd = null) {
    const shift = {
        id: generateId(),
        date,
        startTime,
        endTime,
        volunteersNeeded: parseInt(volunteersNeeded),
        description: description || '',
        breakStart: breakStart || null,
        breakEnd: breakEnd || null,
        applicants: [],
        createdAt: new Date().toISOString()
    };

    if (!appData.shifts) appData.shifts = [];
    appData.shifts.push(shift);
    saveData();

    // Sync to Google Sheets
    await syncShiftToCloud(shift);

    return shift;
}

async function deleteShift(shiftId) {
    if (!appData.shifts) return;
    appData.shifts = appData.shifts.filter(s => s.id !== shiftId);
    saveData();

    // Sync deletion to cloud
    await deleteShiftFromCloud(shiftId);
}

function getShift(shiftId) {
    if (!appData.shifts) return null;
    return appData.shifts.find(s => s.id === shiftId);
}

async function applyForShift(shiftId, volunteerId, notes = '') {
    const shift = getShift(shiftId);
    if (!shift) return false;

    const volunteer = getVolunteer(volunteerId);
    if (!volunteer) return false;

    // Check if already applied
    if (shift.applicants.some(a => a.volunteerId === volunteerId)) {
        alert('This volunteer has already applied for this shift.');
        return false;
    }

    shift.applicants.push({
        volunteerId,
        volunteerName: volunteer.name,
        notes: notes || '',
        appliedAt: new Date().toISOString()
    });

    saveData();

    // Sync to Google Sheets
    await applyForShiftInCloud(shiftId, volunteerId, notes);

    return true;
}

async function removeApplicant(shiftId, volunteerId) {
    const shift = getShift(shiftId);
    if (!shift) return;

    shift.applicants = shift.applicants.filter(a => a.volunteerId !== volunteerId);
    saveData();

    // Sync to Google Sheets
    await removeApplicantFromCloud(shiftId, volunteerId);
}

function renderShifts() {
    const container = document.getElementById('shiftsList');
    const noShiftsMsg = document.getElementById('noShiftsMessage');

    if (!appData.shifts || appData.shifts.length === 0) {
        container.innerHTML = '<p class="no-shifts-message" id="noShiftsMessage">No upcoming shifts scheduled.</p>';
        return;
    }

    // Sort by date (soonest first)
    const sortedShifts = [...appData.shifts].sort((a, b) => new Date(a.date) - new Date(b.date));

    container.innerHTML = sortedShifts.map(shift => {
        const applicantCount = shift.applicants.length;
        const isFull = applicantCount >= shift.volunteersNeeded;
        const breakInfo = shift.breakStart && shift.breakEnd
            ? `<p class="shift-break">Break: ${formatTime(shift.breakStart)} - ${formatTime(shift.breakEnd)}</p>`
            : '';
        const descriptionInfo = shift.description
            ? `<p class="shift-description">${escapeHtml(shift.description)}</p>`
            : '';

        return `
            <div class="shift-card">
                <div class="shift-card-header">
                    <span class="shift-date">📅 ${formatDate(shift.date)}</span>
                    <span class="shift-capacity ${isFull ? 'full' : ''}">${applicantCount}/${shift.volunteersNeeded} volunteers</span>
                </div>
                <p class="shift-times">${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}</p>
                ${breakInfo}
                ${descriptionInfo}
                <div class="shift-actions">
                    <button class="btn btn-secondary btn-small" onclick="openViewApplicantsModal('${shift.id}')">
                        View Applicants
                    </button>
                    ${!isFull ? `<button class="btn btn-primary btn-small" onclick="openApplyModal('${shift.id}')">Apply</button>` : ''}
                    <button class="btn btn-danger btn-small manager-only" onclick="confirmDeleteShift('${shift.id}')">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function confirmDeleteShift(shiftId) {
    if (confirm('Are you sure you want to delete this shift? This will also remove all applications.')) {
        await deleteShift(shiftId);
        renderShifts();
    }
}

function openApplyModal(shiftId) {
    const shift = getShift(shiftId);
    if (!shift) return;

    document.getElementById('applyShiftId').value = shiftId;
    document.getElementById('applyShiftDetails').textContent =
        `${formatDate(shift.date)} | ${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`;
    document.getElementById('volunteerSearch').value = '';
    document.getElementById('selectedVolunteerId').value = '';
    document.getElementById('selectedVolunteerName').textContent = '';
    document.getElementById('applicantNotes').value = '';
    document.getElementById('volunteerSearchResults').classList.remove('active');
    document.getElementById('volunteerSearchResults').innerHTML = '';

    openModal('applyShiftModal');
}

function openViewApplicantsModal(shiftId) {
    const shift = getShift(shiftId);
    if (!shift) return;

    document.getElementById('viewApplicantsShiftInfo').textContent =
        `${formatDate(shift.date)} | ${formatTime(shift.startTime)} - ${formatTime(shift.endTime)} (${shift.applicants.length}/${shift.volunteersNeeded} volunteers)`;

    const container = document.getElementById('applicantsList');

    if (shift.applicants.length === 0) {
        container.innerHTML = '<p class="no-applicants-message">No one has applied for this shift yet.</p>';
    } else {
        // Get current user info for permission check
        const currentUserType = typeof getUserType === 'function' ? getUserType() : 'manager';
        const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        const currentUserId = currentUser ? currentUser.id : null;

        container.innerHTML = shift.applicants.map(applicant => {
            // Show Remove button only for managers OR if this is the volunteer's own application
            const canRemove = currentUserType === 'manager' || applicant.volunteerId === currentUserId;
            const removeButton = canRemove ?
                `<button class="btn btn-danger btn-small" onclick="removeApplicantAndRefresh('${shift.id}', '${applicant.volunteerId}')">
                    ${currentUserType === 'manager' ? 'Remove' : 'Remove My Application'}
                </button>` : '';

            return `
                <div class="applicant-item">
                    <div>
                        <div class="applicant-name">${escapeHtml(applicant.volunteerName)}</div>
                        ${applicant.notes ? `<div class="applicant-notes">"${escapeHtml(applicant.notes)}"</div>` : ''}
                    </div>
                    ${removeButton}
                </div>
            `;
        }).join('');
    }

    openModal('viewApplicantsModal');
}

async function removeApplicantAndRefresh(shiftId, volunteerId) {
    if (confirm('Remove this applicant from the shift?')) {
        await removeApplicant(shiftId, volunteerId);
        openViewApplicantsModal(shiftId); // Refresh the list
        renderShifts(); // Update the main shifts list
    }
}

function searchVolunteersForShift(query) {
    const resultsContainer = document.getElementById('volunteerSearchResults');

    if (!query.trim()) {
        resultsContainer.classList.remove('active');
        resultsContainer.innerHTML = '';
        return;
    }

    const matches = appData.volunteers.filter(v =>
        v.name.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 5); // Limit to 5 results

    if (matches.length === 0) {
        resultsContainer.classList.add('active');
        resultsContainer.innerHTML = '<div class="search-result-item">No volunteers found</div>';
        return;
    }

    resultsContainer.classList.add('active');
    resultsContainer.innerHTML = matches.map(v => `
        <div class="search-result-item" onclick="selectVolunteer('${v.id}', '${escapeHtml(v.name)}')">
            ${escapeHtml(v.name)}
        </div>
    `).join('');
}

function selectVolunteer(volunteerId, volunteerName) {
    document.getElementById('selectedVolunteerId').value = volunteerId;
    document.getElementById('selectedVolunteerName').textContent = `✓ Selected: ${volunteerName}`;
    document.getElementById('volunteerSearch').value = '';
    document.getElementById('volunteerSearchResults').classList.remove('active');
    document.getElementById('volunteerSearchResults').innerHTML = '';
}

// ========================================
// UI Rendering
// ========================================

function updateStats() {
    const totalVolunteers = appData.volunteers.length;
    const totalSessions = appData.volunteers.reduce((sum, v) => sum + v.hours.length, 0);
    const totalHours = appData.volunteers.reduce((sum, v) => sum + getVolunteerTotalHours(v), 0);

    document.getElementById('totalVolunteers').textContent = totalVolunteers;
    document.getElementById('totalSessions').textContent = totalSessions;
    document.getElementById('totalHours').textContent = totalHours.toFixed(1);
}

function renderVolunteers() {
    const grid = document.getElementById('volunteersGrid');
    const emptyState = document.getElementById('emptyState');

    grid.innerHTML = '';

    const volunteersToShow = getFilteredVolunteers();

    if (appData.volunteers.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    volunteersToShow.forEach(volunteer => {
        const totalHours = getVolunteerTotalHours(volunteer);
        const initials = volunteer.name.split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);

        const card = document.createElement('div');
        card.className = 'volunteer-card';
        card.innerHTML = `
            <div class="volunteer-header">
                <div class="volunteer-avatar">${initials}</div>
                <div>
                    <h3 class="volunteer-name">${escapeHtml(volunteer.name)}</h3>
                    <div class="volunteer-hours-badge">${totalHours.toFixed(1)} hours logged</div>
                </div>
            </div>
            <div class="volunteer-contact">
                <p>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                    </svg>
                    ${escapeHtml(volunteer.phone)}
                </p>
                <p>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                        <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                    ${escapeHtml(volunteer.email)}
                </p>
            </div>
            <div class="volunteer-actions">
                <button class="btn btn-primary btn-small" onclick="openHoursModal('${volunteer.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    Add Hours
                </button>
                <button class="btn btn-secondary btn-small" onclick="openDetailsModal('${volunteer.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    View Details
                </button>
                <button class="btn btn-secondary btn-small" onclick="openEditModal('${volunteer.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    Edit
                </button>
                <button class="btn btn-danger btn-small" onclick="confirmDeleteVolunteer('${volunteer.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    Delete
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// Modal Management
// ========================================

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    document.body.style.overflow = '';
}

// Track if we're editing vs adding
let editVolunteerId = null;

function openEditModal(volunteerId) {
    const volunteer = getVolunteer(volunteerId);
    if (!volunteer) return;

    editVolunteerId = volunteerId;

    // Update modal title
    document.querySelector('#volunteerModal .modal-header h3').textContent = 'Edit Volunteer';
    document.querySelector('#volunteerModal button[type="submit"]').textContent = 'Save Changes';

    // Populate form with existing data
    document.getElementById('volunteerName').value = volunteer.name;
    document.getElementById('volunteerPhone').value = volunteer.phone === 'N/A' ? '' : volunteer.phone;
    document.getElementById('volunteerEmail').value = volunteer.email === 'N/A' ? '' : volunteer.email;
    document.getElementById('volunteerAddress').value = (volunteer.address || '') === 'N/A' ? '' : (volunteer.address || '');
    document.getElementById('volunteerSuburb').value = (volunteer.suburb || '') === 'N/A' ? '' : (volunteer.suburb || '');
    document.getElementById('volunteerEmergencyContact').value = (volunteer.emergencyContact || '') === 'N/A' ? '' : (volunteer.emergencyContact || '');

    openModal('volunteerModal');
}

function openAddModal() {
    editVolunteerId = null;

    // Reset modal title
    document.querySelector('#volunteerModal .modal-header h3').textContent = 'Add New Volunteer';
    document.querySelector('#volunteerModal button[type="submit"]').textContent = 'Save Volunteer';

    document.getElementById('volunteerForm').reset();
    openModal('volunteerModal');
}

function openHoursModal(volunteerId) {
    const volunteer = getVolunteer(volunteerId);
    if (!volunteer) return;

    document.getElementById('hoursVolunteerId').value = volunteerId;
    document.getElementById('hoursForName').textContent = `Adding hours for ${volunteer.name}`;
    document.getElementById('hoursForm').reset();

    // Reset break fields
    document.getElementById('hadBreak').checked = false;
    document.getElementById('breakTimeFields').style.display = 'none';
    document.getElementById('breakStart').value = '';
    document.getElementById('breakEnd').value = '';
    document.getElementById('breakDurationDisplay').textContent = '';

    // Set default date to today
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local timezone
    document.getElementById('workDate').value = today;

    openModal('hoursModal');
}

let currentDetailsVolunteerId = null;

function openDetailsModal(volunteerId) {
    const volunteer = getVolunteer(volunteerId);
    if (!volunteer) return;

    currentDetailsVolunteerId = volunteerId;

    document.getElementById('detailsName').textContent = volunteer.name;
    document.getElementById('detailsPhone').textContent = volunteer.phone;
    document.getElementById('detailsEmail').textContent = volunteer.email;
    document.getElementById('detailsAddress').textContent = volunteer.address || 'N/A';
    document.getElementById('detailsSuburb').textContent = volunteer.suburb || 'N/A';
    document.getElementById('detailsEmergencyContact').textContent = volunteer.emergencyContact || 'N/A';

    // Display total hours with break info
    const totalHours = getVolunteerTotalHours(volunteer).toFixed(2);
    const totalBreakMins = getVolunteerTotalBreakMinutes(volunteer);
    let hoursText = totalHours + ' hours';
    if (totalBreakMins > 0) {
        const breakHrs = Math.floor(totalBreakMins / 60);
        const breakMins = totalBreakMins % 60;
        const breakStr = breakHrs > 0 ? `${breakHrs}h ${breakMins}min` : `${breakMins}min`;
        hoursText += ` (${breakStr} breaks deducted)`;
    }
    document.getElementById('detailsTotalHours').textContent = hoursText;

    renderHoursTable(volunteer);
    openModal('detailsModal');
}

function renderHoursTable(volunteer) {
    const tbody = document.getElementById('hoursTableBody');
    const container = document.getElementById('hoursTableContainer');
    const noHoursMsg = document.getElementById('noHoursMessage');

    tbody.innerHTML = '';

    if (volunteer.hours.length === 0) {
        container.classList.add('hidden');
        noHoursMsg.classList.remove('hidden');
        return;
    }

    container.classList.remove('hidden');
    noHoursMsg.classList.add('hidden');

    // Sort hours by date (most recent first)
    const sortedHours = [...volunteer.hours].sort((a, b) =>
        new Date(b.date) - new Date(a.date)
    );

    sortedHours.forEach(entry => {
        const hours = calculateHours(entry.checkIn, entry.checkOut, entry.breakStart, entry.breakEnd);
        const breakMins = calculateBreakDuration(entry.breakStart, entry.breakEnd);
        const breakDisplay = breakMins > 0 ? ` <span class="break-badge">(${breakMins}min break)</span>` : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDate(entry.date)}</td>
            <td>${formatTime(entry.checkIn)}</td>
            <td>${formatTime(entry.checkOut)}</td>
            <td>${hours} hrs${breakDisplay}</td>
            <td>
                <button class="btn btn-danger btn-small" onclick="deleteHoursAndRefresh('${volunteer.id}', '${entry.id}')">
                    Delete
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteHoursAndRefresh(volunteerId, entryId) {
    if (confirm('Delete this hours entry?')) {
        await deleteHoursEntry(volunteerId, entryId);
        const volunteer = getVolunteer(volunteerId);
        if (volunteer) {
            renderHoursTable(volunteer);
            document.getElementById('detailsTotalHours').textContent =
                getVolunteerTotalHours(volunteer).toFixed(2) + ' hours';
        }
        updateStats();
        renderVolunteers();
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr; // Return original if invalid

    return date.toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function formatTime(timeStr) {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
}

async function confirmDeleteVolunteer(volunteerId) {
    const volunteer = getVolunteer(volunteerId);
    if (!volunteer) return;

    if (confirm(`Are you sure you want to delete ${volunteer.name}? This will also delete all their logged hours.`)) {
        await deleteVolunteer(volunteerId);
        renderVolunteers();
        updateStats();
        updateVolunteerCount();
    }
}

// ========================================
// Excel Export
// ========================================

async function exportToExcel() {
    if (appData.volunteers.length === 0) {
        alert('No volunteer data to export. Add some volunteers first!');
        return;
    }

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Volunteer Hours Tracker';
    workbook.created = new Date();

    // --- VOLUNTEER HOURS SHEET ---
    const hoursSheet = workbook.addWorksheet('Volunteer Hours');

    // Define columns
    hoursSheet.columns = [
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Address', key: 'address', width: 35 },
        { header: 'Suburb', key: 'suburb', width: 15 },
        { header: 'Emergency Contact', key: 'emergencyContact', width: 25 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Check In', key: 'checkIn', width: 10 },
        { header: 'Check Out', key: 'checkOut', width: 10 },
        { header: 'Hours Worked', key: 'hoursWorked', width: 12 }
    ];

    // Style header row (row 1)
    hoursSheet.getRow(1).font = { bold: true, size: 14 };
    hoursSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF667EEA' }
    };
    hoursSheet.getRow(1).font.color = { argb: 'FFFFFFFF' };

    // Add data
    appData.volunteers.forEach(volunteer => {
        if (volunteer.hours.length === 0) {
            hoursSheet.addRow({
                name: volunteer.name,
                phone: volunteer.phone,
                email: volunteer.email,
                address: volunteer.address || 'N/A',
                suburb: volunteer.suburb || 'N/A',
                emergencyContact: volunteer.emergencyContact || 'N/A',
                date: '',
                checkIn: '',
                checkOut: '',
                hoursWorked: 0
            });
        } else {
            volunteer.hours.forEach(entry => {
                const hoursWorked = parseFloat(calculateHours(entry.checkIn, entry.checkOut));
                hoursSheet.addRow({
                    name: volunteer.name,
                    phone: volunteer.phone,
                    email: volunteer.email,
                    address: volunteer.address || 'N/A',
                    suburb: volunteer.suburb || 'N/A',
                    emergencyContact: volunteer.emergencyContact || 'N/A',
                    date: entry.date,
                    checkIn: entry.checkIn,
                    checkOut: entry.checkOut,
                    hoursWorked: hoursWorked
                });
            });
        }
    });

    // --- SUMMARY SHEET ---
    const summarySheet = workbook.addWorksheet('Summary');

    summarySheet.columns = [
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Address', key: 'address', width: 35 },
        { header: 'Suburb', key: 'suburb', width: 15 },
        { header: 'Emergency Contact', key: 'emergencyContact', width: 25 },
        { header: 'Total Sessions', key: 'sessions', width: 15 },
        { header: 'Total Hours', key: 'hours', width: 12 }
    ];

    // Style summary header row
    summarySheet.getRow(1).font = { bold: true, size: 14 };
    summarySheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF11998E' }
    };
    summarySheet.getRow(1).font.color = { argb: 'FFFFFFFF' };

    // Add summary data
    appData.volunteers.forEach(v => {
        summarySheet.addRow({
            name: v.name,
            phone: v.phone,
            email: v.email,
            address: v.address || 'N/A',
            suburb: v.suburb || 'N/A',
            emergencyContact: v.emergencyContact || 'N/A',
            sessions: v.hours.length,
            hours: getVolunteerTotalHours(v).toFixed(2)
        });
    });

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    const filename = `volunteer_hours_${date}.xlsx`;

    // Download using FileSaver
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, filename);
}

// ========================================
// Event Listeners
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    renderVolunteers();
    updateStats();
    updateVolunteerCount();

    // Import Excel Button
    document.getElementById('importExcelBtn').addEventListener('click', () => {
        document.getElementById('excelFileInput').click();
    });

    // Excel File Input Change
    document.getElementById('excelFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            importFromExcel(file);
            e.target.value = ''; // Reset input for re-upload
        }
    });

    // Restore Backup Button
    document.getElementById('restoreBackupBtn').addEventListener('click', () => {
        document.getElementById('backupFileInput').click();
    });

    // Backup File Input Change
    document.getElementById('backupFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            restoreFromBackup(file);
            e.target.value = ''; // Reset input for re-upload
        }
    });

    // Search Input
    document.getElementById('searchInput').addEventListener('input', (e) => {
        filterVolunteers(e.target.value);
    });

    // Add Volunteer Button
    document.getElementById('addVolunteerBtn').addEventListener('click', () => {
        openAddModal();
    });

    // Volunteer Form Submit (handles both Add and Edit)
    document.getElementById('volunteerForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('volunteerName').value;
        const phone = document.getElementById('volunteerPhone').value;
        const email = document.getElementById('volunteerEmail').value;
        const address = document.getElementById('volunteerAddress').value;
        const suburb = document.getElementById('volunteerSuburb').value;
        const emergencyContact = document.getElementById('volunteerEmergencyContact').value;

        if (editVolunteerId) {
            // Edit mode
            updateVolunteer(editVolunteerId, name, phone, email, address, suburb, emergencyContact);
            editVolunteerId = null;
        } else {
            // Add mode
            addVolunteer(name, phone, email, address, suburb, emergencyContact);
        }

        closeModal('volunteerModal');
        renderVolunteers();
        updateStats();
        updateVolunteerCount();
    });

    // Hours Form Submit
    document.getElementById('hoursForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const volunteerId = document.getElementById('hoursVolunteerId').value;
        const date = document.getElementById('workDate').value;
        const checkIn = document.getElementById('checkInTime').value;
        const checkOut = document.getElementById('checkOutTime').value;

        // Get break times if checkbox is checked
        const hadBreak = document.getElementById('hadBreak').checked;
        let breakStart = null;
        let breakEnd = null;
        if (hadBreak) {
            breakStart = document.getElementById('breakStart').value || null;
            breakEnd = document.getElementById('breakEnd').value || null;
        }

        addHoursEntry(volunteerId, date, checkIn, checkOut, breakStart, breakEnd);
        closeModal('hoursModal');
        renderVolunteers();
        updateStats();

        // Reset break fields
        document.getElementById('hadBreak').checked = false;
        document.getElementById('breakTimeFields').style.display = 'none';
        document.getElementById('breakStart').value = '';
        document.getElementById('breakEnd').value = '';
        document.getElementById('breakDurationDisplay').textContent = '';
    });

    // Break checkbox toggle
    document.getElementById('hadBreak').addEventListener('change', (e) => {
        const breakFields = document.getElementById('breakTimeFields');
        breakFields.style.display = e.target.checked ? 'block' : 'none';
        if (!e.target.checked) {
            document.getElementById('breakStart').value = '';
            document.getElementById('breakEnd').value = '';
            document.getElementById('breakDurationDisplay').textContent = '';
        }
    });

    // Calculate break duration on input change
    ['breakStart', 'breakEnd'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            const breakStart = document.getElementById('breakStart').value;
            const breakEnd = document.getElementById('breakEnd').value;
            const display = document.getElementById('breakDurationDisplay');
            if (breakStart && breakEnd) {
                const minutes = calculateBreakDuration(breakStart, breakEnd);
                if (minutes > 0) {
                    const hrs = Math.floor(minutes / 60);
                    const mins = minutes % 60;
                    display.textContent = `Break duration: ${hrs > 0 ? hrs + 'h ' : ''}${mins}min`;
                } else {
                    display.textContent = 'Invalid break times';
                }
            } else {
                display.textContent = '';
            }
        });
    });

    // ========================================
    // Shifts Dashboard Event Handlers
    // ========================================

    // Create Shift Button
    document.getElementById('createShiftBtn').addEventListener('click', () => {
        openModal('createShiftModal');
    });

    // Upcoming Shifts Button
    document.getElementById('upcomingShiftsBtn').addEventListener('click', () => {
        renderShifts();
        openModal('upcomingShiftsModal');
    });

    // Shift break checkbox toggle
    document.getElementById('shiftHasBreak').addEventListener('change', (e) => {
        document.getElementById('shiftBreakFields').style.display =
            e.target.checked ? 'block' : 'none';
    });

    // Create Shift Form Submit
    document.getElementById('createShiftForm').addEventListener('submit', (e) => {
        e.preventDefault();

        const date = document.getElementById('shiftDate').value;
        const startTime = document.getElementById('shiftStartTime').value;
        const endTime = document.getElementById('shiftEndTime').value;
        const volunteersNeeded = document.getElementById('shiftVolunteersNeeded').value;
        const description = document.getElementById('shiftDescription').value;

        const hasBreak = document.getElementById('shiftHasBreak').checked;
        let breakStart = null;
        let breakEnd = null;
        if (hasBreak) {
            breakStart = document.getElementById('shiftBreakStart').value || null;
            breakEnd = document.getElementById('shiftBreakEnd').value || null;
        }

        createShift(date, startTime, endTime, volunteersNeeded, description, breakStart, breakEnd);

        // Reset form
        document.getElementById('createShiftForm').reset();
        document.getElementById('shiftBreakFields').style.display = 'none';
        document.getElementById('shiftVolunteersNeeded').value = '5';

        closeModal('createShiftModal');
        alert('Shift created successfully! View it in Upcoming Shifts.');
    });

    // Volunteer Search for Apply Modal
    document.getElementById('volunteerSearch').addEventListener('input', (e) => {
        searchVolunteersForShift(e.target.value);
    });

    // Apply for Shift Form Submit
    document.getElementById('applyShiftForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const shiftId = document.getElementById('applyShiftId').value;
        const volunteerId = document.getElementById('selectedVolunteerId').value;
        const notes = document.getElementById('applicantNotes').value;

        if (!volunteerId) {
            alert('Please select a volunteer first.');
            return;
        }

        if (await applyForShift(shiftId, volunteerId, notes)) {
            closeModal('applyShiftModal');
            renderShifts();
            alert('Application submitted successfully!');
        }
    });

    // Export Button
    document.getElementById('exportBtn').addEventListener('click', exportToExcel);

    // Volunteer Agreement Button - opens modal
    document.getElementById('volunteerAgreementBtn').addEventListener('click', () => {
        openModal('volunteerAgreementModal');
    });

    // Print Agreement Button - opens PDF in new tab for printing
    document.getElementById('printAgreementBtn').addEventListener('click', () => {
        window.open('Template - General Volunteer Agreement - V4 - June 2025.pdf', '_blank');
    });

    // Modal Close Buttons
    document.querySelectorAll('.modal-close, .modal-backdrop, [data-modal]').forEach(el => {
        el.addEventListener('click', (e) => {
            const modalId = e.target.dataset.modal || e.target.closest('[data-modal]')?.dataset.modal;
            if (modalId) {
                closeModal(modalId);
            } else if (e.target.classList.contains('modal-backdrop')) {
                const modal = e.target.closest('.modal');
                if (modal) modal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                modal.classList.remove('active');
            });
            document.body.style.overflow = '';
        }
    });

    // ========================================
    // Volunteer Profile Edit (Volunteer Dashboard)
    // ========================================

    const editMyProfileBtn = document.getElementById('editMyProfileBtn');
    if (editMyProfileBtn) {
        editMyProfileBtn.addEventListener('click', () => {
            const session = getSession();
            if (!session || session.userType !== 'volunteer') return;

            const volunteer = appData.volunteers.find(v => v.id === session.userData.id) || session.userData;

            // Open the volunteer modal in edit mode
            document.getElementById('volunteerName').value = volunteer.name || '';
            document.getElementById('volunteerPhone').value = volunteer.phone || '';
            document.getElementById('volunteerEmail').value = volunteer.email || '';
            document.getElementById('volunteerAddress').value = volunteer.address || '';
            document.getElementById('volunteerSuburb').value = volunteer.suburb || '';
            document.getElementById('volunteerEmergencyContact').value = volunteer.emergencyContact || '';

            // Set edit mode with volunteer's ID
            editVolunteerId = volunteer.id;

            // Update modal title
            document.querySelector('#volunteerModal .modal-header h3').textContent = 'Edit My Profile';

            openModal('volunteerModal');
        });
    }

    // ========================================
    // Login/Logout Event Handlers
    // ========================================

    // Volunteer Login Button (opens modal)
    document.getElementById('volunteerLoginBtn').addEventListener('click', () => {
        openModal('volunteerLoginModal');
    });

    // Manager Login Button (opens modal and initializes Google Sign-In)
    document.getElementById('managerLoginBtn').addEventListener('click', () => {
        openModal('managerLoginModal');
        // Initialize Google Sign-In button after modal is visible
        setTimeout(() => {
            initializeGoogleSignIn();
        }, 100);
    });

    // Volunteer Login Form Submit
    document.getElementById('volunteerLoginForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('loginName').value.trim();
        const email = document.getElementById('loginEmail').value.trim();
        const phone = document.getElementById('loginPhone').value.trim();
        const errorEl = document.getElementById('loginError');

        errorEl.textContent = '';

        const result = await volunteerLoginAPI(name, email, phone);

        if (result.success) {
            saveSession('volunteer', result.volunteer);
            closeModal('volunteerLoginModal');
            document.getElementById('volunteerLoginForm').reset();
            await initializeApp();
        } else {
            errorEl.textContent = result.error;
        }
    });

    // Google Sign-In Initialization
    function initializeGoogleSignIn() {
        const buttonContainer = document.getElementById('googleSignInButton');
        if (!buttonContainer) return;

        // Clear any existing button
        buttonContainer.innerHTML = '';

        // Initialize Google Sign-In
        google.accounts.id.initialize({
            client_id: '222278000818-i4f9uevcg1keajlcv3onrrtra9g2ojka.apps.googleusercontent.com',
            callback: handleGoogleSignInResponse,
            auto_select: false
        });

        // Render the button
        google.accounts.id.renderButton(
            buttonContainer,
            {
                theme: 'outline',
                size: 'large',
                type: 'standard',
                text: 'signin_with',
                shape: 'rectangular',
                width: 280
            }
        );
    }

    // Handle Google Sign-In Response
    async function handleGoogleSignInResponse(response) {
        const errorEl = document.getElementById('managerLoginError');
        errorEl.textContent = '';

        try {
            // Decode the JWT token to get user info
            const payload = JSON.parse(atob(response.credential.split('.')[1]));
            const email = payload.email;

            // Verify with backend that this email is an authorized manager
            const result = await managerLoginAPI(email);

            if (result.success) {
                saveSession('manager', { email: result.email, name: payload.name, picture: payload.picture });
                closeModal('managerLoginModal');
                await initializeApp();
            } else {
                errorEl.textContent = result.error || 'Access denied. Your email is not authorized as a manager.';
            }
        } catch (error) {
            console.error('Google Sign-In error:', error);
            errorEl.textContent = 'Sign-in failed. Please try again.';
        }
    }

    // Logout Button
    document.getElementById('logoutBtn').addEventListener('click', () => {
        if (confirm('Are you sure you want to logout?')) {
            clearSession();
            document.body.classList.remove('logged-in', 'volunteer-mode', 'manager-mode');
            location.reload();
        }
    });

    // ========================================
    // App Initialization
    // ========================================

    async function initializeApp() {
        const session = getSession();

        if (!session) {
            // Not logged in - show login screen
            return;
        }

        // Apply role class BEFORE showing content (prevents manager content flash for volunteers)
        if (session.userType === 'volunteer') {
            document.body.classList.add('volunteer-mode');
            document.getElementById('headerTitle').textContent = 'Volunteer Hub';
        } else {
            document.body.classList.add('manager-mode');
            document.getElementById('headerTitle').textContent = 'Manager Hub';
        }

        // Mark as logged in (now safe to show content)
        document.body.classList.add('logged-in');

        // Fetch data from Google Sheets
        const success = await fetchAllData();

        if (!success) {
            // Fall back to localStorage if cloud fails
            loadData();
        }

        if (session.userType === 'volunteer') {
            // Volunteer mode - limited access

            // Update volunteer's data from cloud
            const volunteer = appData.volunteers.find(v => v.id === session.userData.id);
            if (volunteer) {
                saveSession('volunteer', volunteer);
                renderVolunteerDashboard(volunteer);
            } else {
                // Volunteer not found in cloud data, use session data
                renderVolunteerDashboard(session.userData);
            }
        } else {
            // Manager mode - full access
            renderVolunteers();
            updateStats();
            updateVolunteerCount();
            checkPendingReviews(); // Check for shifts needing review
        }
    }

    // Volunteer Dashboard Rendering Functions
    function renderVolunteerDashboard(volunteer) {
        // Set welcome name
        document.getElementById('volunteerWelcomeName').textContent = volunteer.name;

        // Render profile
        renderVolunteerProfile(volunteer);

        // Render hours
        renderVolunteerHours(volunteer);

        // Render applied shifts
        renderAppliedShifts(volunteer.id);

        // Render available shifts
        renderAvailableShifts(volunteer.id);
    }

    function renderVolunteerProfile(volunteer) {
        const container = document.getElementById('myProfileCard');
        container.innerHTML = `
            <div class="profile-item">
                <span class="profile-label">Name:</span>
                <span class="profile-value">${escapeHtml(volunteer.name)}</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Email:</span>
                <span class="profile-value">${escapeHtml(volunteer.email || 'Not provided')}</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Phone:</span>
                <span class="profile-value">${escapeHtml(volunteer.phone || 'Not provided')}</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Address:</span>
                <span class="profile-value">${escapeHtml(volunteer.address || 'Not provided')}</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Suburb:</span>
                <span class="profile-value">${escapeHtml(volunteer.suburb || 'Not provided')}</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Emergency Contact:</span>
                <span class="profile-value">${escapeHtml(volunteer.emergencyContact || 'Not provided')}</span>
            </div>
        `;
    }

    function renderVolunteerHours(volunteer) {
        const hours = volunteer.hours || [];
        const totalHours = getVolunteerTotalHours(volunteer);
        const totalSessions = hours.length;

        document.getElementById('myTotalHours').textContent = totalHours.toFixed(1);
        document.getElementById('myTotalSessions').textContent = totalSessions;

        const container = document.getElementById('myHoursHistory');

        if (hours.length === 0) {
            container.innerHTML = '<p class="no-data-message">No hours logged yet.</p>';
            return;
        }

        // Sort by date descending
        const sortedHours = [...hours].sort((a, b) => new Date(b.date) - new Date(a.date));

        container.innerHTML = sortedHours.map(entry => {
            const hoursWorked = calculateHours(entry.checkIn, entry.checkOut, entry.breakStart, entry.breakEnd);
            return `
                <div class="hours-entry">
                    <div>
                        <span class="hours-entry-date">${formatDate(entry.date)}</span>
                        <span class="hours-entry-time">${entry.checkIn} - ${entry.checkOut}</span>
                    </div>
                    <span class="hours-entry-duration">${hoursWorked} hrs</span>
                </div>
            `;
        }).join('');
    }

    // Check for existing session on load
    initializeApp();
});

// Global function for volunteer to apply for a shift from dashboard
async function volunteerApplyForShift(shiftId, event) {
    // Find and disable the button to prevent double-clicks
    const button = event?.target?.closest('.apply-btn') || document.querySelector(`[onclick*="volunteerApplyForShift('${shiftId}')"]`);
    if (button) {
        if (button.disabled) return; // Already processing
        button.disabled = true;
        button.innerHTML = '<span class="loader-spinner-small"></span> Applying...';
    }

    const session = getSession();
    if (!session || session.userType !== 'volunteer') {
        alert('Please login as a volunteer to apply for shifts.');
        if (button) {
            button.disabled = false;
            button.innerHTML = 'Apply for Shift';
        }
        return;
    }

    const volunteerId = session.userData.id;
    const notes = prompt('Add a note for your application (optional):') || '';

    const success = await applyForShift(shiftId, volunteerId, notes);
    if (success) {
        alert('Successfully applied for the shift!');
        // Refresh the dashboard
        const volunteer = appData.volunteers.find(v => v.id === volunteerId) || session.userData;
        renderAppliedShifts(volunteerId);
        renderAvailableShifts(volunteerId);
    } else if (button) {
        button.disabled = false;
        button.innerHTML = 'Apply for Shift';
    }
}

// Make render functions available globally for refresh
function renderAppliedShifts(volunteerId) {
    const container = document.getElementById('myAppliedShifts');
    if (!container) return;

    const shifts = appData.shifts || [];

    const appliedShifts = shifts.filter(shift =>
        shift.applicants && shift.applicants.some(a => a.volunteerId === volunteerId)
    );

    if (appliedShifts.length === 0) {
        container.innerHTML = '<p class="no-data-message">You haven\'t applied for any shifts yet.</p>';
        return;
    }

    container.innerHTML = appliedShifts.map(shift => {
        const myApplication = shift.applicants.find(a => a.volunteerId === volunteerId);
        return `
            <div class="volunteer-shift-card">
                <div class="shift-date">${formatDate(shift.date)}</div>
                <div class="shift-time">${shift.startTime} - ${shift.endTime}</div>
                ${shift.description ? `<div class="shift-description">${escapeHtml(shift.description)}</div>` : ''}
                ${myApplication.notes ? `<div class="shift-applicants">Your note: ${escapeHtml(myApplication.notes)}</div>` : ''}
            </div>
        `;
    }).join('');
}

function renderAvailableShifts(volunteerId) {
    const container = document.getElementById('volunteerShiftsList');
    if (!container) return;

    const shifts = appData.shifts || [];

    // Filter to future shifts only
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local timezone
    const futureShifts = shifts.filter(shift => shift.date >= today);

    if (futureShifts.length === 0) {
        container.innerHTML = '<p class="no-data-message">No upcoming shifts available.</p>';
        return;
    }

    container.innerHTML = futureShifts.map(shift => {
        const alreadyApplied = shift.applicants && shift.applicants.some(a => a.volunteerId === volunteerId);
        const applicantCount = shift.applicants ? shift.applicants.length : 0;
        const applicantNames = shift.applicants ? shift.applicants.map(a => a.volunteerName).join(', ') : '';

        return `
            <div class="volunteer-shift-card">
                <div class="shift-date">${formatDate(shift.date)}</div>
                <div class="shift-time">${shift.startTime} - ${shift.endTime}</div>
                ${shift.description ? `<div class="shift-description">${escapeHtml(shift.description)}</div>` : ''}
                <div class="shift-applicants">
                    ${applicantCount}/${shift.volunteersNeeded} volunteers signed up
                    ${applicantNames ? `<br><small>Signed up: ${escapeHtml(applicantNames)}</small>` : ''}
                </div>
                ${alreadyApplied
                ? '<button class="btn btn-secondary btn-small" disabled>Already Applied</button>'
                : `<button class="btn btn-primary btn-small apply-btn" onclick="volunteerApplyForShift('${shift.id}')">Apply for Shift</button>`
            }
            </div>
        `;
    }).join('');
}

// ========================================
// Shift Review System
// ========================================

let pendingReviews = [];

async function checkPendingReviews() {
    try {
        const result = await SheetsAPI.getPendingReviews();
        if (result.success) {
            pendingReviews = result.pendingShifts || [];
            updateReviewBadge();
        }
    } catch (error) {
        console.error('Error checking pending reviews:', error);
    }
}

function updateReviewBadge() {
    const badge = document.getElementById('reviewBadge');
    if (!badge) return;

    if (pendingReviews.length > 0) {
        badge.textContent = pendingReviews.length;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function openReviewShiftsModal() {
    const modal = document.getElementById('reviewShiftsModal');
    const content = document.getElementById('reviewShiftsContent');

    if (!modal || !content) return;

    if (pendingReviews.length === 0) {
        content.innerHTML = `
            <div class="no-pending-reviews">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <h4>All Caught Up!</h4>
                <p>No completed shifts need review at this time.</p>
            </div>
        `;
    } else {
        content.innerHTML = pendingReviews.map(shift => renderReviewShiftCard(shift)).join('');
    }

    modal.classList.add('active');
}

function renderReviewShiftCard(shift) {
    const attendeesHtml = shift.applicants.map((app, index) => `
        <div class="review-attendee-row" data-volunteer-id="${app.volunteerId}" data-shift-id="${shift.id}">
            <span class="attendee-name">${escapeHtml(app.volunteerName)}</span>
            <input type="time" class="check-in" value="${shift.startTime}" title="Check In">
            <input type="time" class="check-out" value="${shift.endTime}" title="Check Out">
            <input type="time" class="break-start" value="${shift.breakStart || ''}" title="Break Start">
            <input type="time" class="break-end" value="${shift.breakEnd || ''}" title="Break End">
            <button class="remove-attendee" onclick="removeReviewAttendee(this)" title="Remove">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `).join('');

    return `
        <div class="review-shift-card" data-shift-id="${shift.id}">
            <div class="review-shift-header">
                <h4>${escapeHtml(shift.date)}</h4>
                <span class="shift-time">${shift.startTime} - ${shift.endTime}${shift.description ? ' • ' + escapeHtml(shift.description) : ''}</span>
            </div>
            <div class="review-attendees-header" style="display: grid; grid-template-columns: 1fr repeat(4, 100px) 40px; gap: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.75rem; color: var(--text-secondary);">
                <span>Name</span>
                <span>Check In</span>
                <span>Check Out</span>
                <span>Break Start</span>
                <span>Break End</span>
                <span></span>
            </div>
            <div class="review-attendees" id="attendees-${shift.id}">
                ${attendeesHtml || '<p style="color: var(--text-secondary); padding: 1rem;">No applicants for this shift.</p>'}
            </div>
            <div class="add-volunteer-row">
                <select id="add-volunteer-${shift.id}" class="form-control" style="max-width: 200px; display: inline-block;">
                    <option value="">Add a volunteer...</option>
                    ${appData.volunteers.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary btn-small" onclick="addReviewAttendee('${shift.id}')">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Add
                </button>
            </div>
            <div class="review-actions">
                <button class="btn btn-primary" onclick="submitShiftReview('${shift.id}')">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Submit Review
                </button>
            </div>
        </div>
    `;
}

function removeReviewAttendee(button) {
    const row = button.closest('.review-attendee-row');
    if (row) {
        row.remove();
    }
}

function addReviewAttendee(shiftId) {
    const select = document.getElementById(`add-volunteer-${shiftId}`);
    const attendeesContainer = document.getElementById(`attendees-${shiftId}`);
    const shift = pendingReviews.find(s => s.id === shiftId);

    if (!select || !attendeesContainer || !shift || !select.value) return;

    const volunteerId = select.value;
    const volunteer = appData.volunteers.find(v => v.id === volunteerId);
    if (!volunteer) return;

    // Check if already added
    if (attendeesContainer.querySelector(`[data-volunteer-id="${volunteerId}"]`)) {
        alert('This volunteer is already in the list.');
        return;
    }

    const newRow = document.createElement('div');
    newRow.className = 'review-attendee-row';
    newRow.dataset.volunteerId = volunteerId;
    newRow.dataset.shiftId = shiftId;
    newRow.innerHTML = `
        <span class="attendee-name">${escapeHtml(volunteer.name)}</span>
        <input type="time" class="check-in" value="${shift.startTime}" title="Check In">
        <input type="time" class="check-out" value="${shift.endTime}" title="Check Out">
        <input type="time" class="break-start" value="${shift.breakStart || ''}" title="Break Start">
        <input type="time" class="break-end" value="${shift.breakEnd || ''}" title="Break End">
        <button class="remove-attendee" onclick="removeReviewAttendee(this)" title="Remove">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    `;

    attendeesContainer.appendChild(newRow);
    select.value = '';
}

async function submitShiftReview(shiftId) {
    const card = document.querySelector(`.review-shift-card[data-shift-id="${shiftId}"]`);
    if (!card) return;

    // Find and disable the submit button to prevent double-clicks
    const submitBtn = card.querySelector('.review-actions .btn-primary');
    if (submitBtn) {
        if (submitBtn.disabled) return; // Already submitting
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="loader-spinner-small"></span> Submitting...';
    }

    const attendeeRows = card.querySelectorAll('.review-attendee-row');
    const attendees = [];

    attendeeRows.forEach(row => {
        const volunteerId = row.dataset.volunteerId;
        const checkIn = row.querySelector('.check-in').value;
        const checkOut = row.querySelector('.check-out').value;
        const breakStart = row.querySelector('.break-start').value;
        const breakEnd = row.querySelector('.break-end').value;

        if (volunteerId && checkIn && checkOut) {
            attendees.push({
                volunteerId,
                checkIn,
                checkOut,
                breakStart: breakStart || null,
                breakEnd: breakEnd || null
            });
        }
    });

    if (attendees.length === 0 && !confirm('No attendees are listed. This will mark the shift as reviewed without logging any hours. Continue?')) {
        // Re-enable button if user cancels
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Submit Review`;
        }
        return;
    }

    try {
        const result = await SheetsAPI.submitShiftReview({
            shiftId,
            attendees
        });

        if (result.success) {
            // Delete the shift from Google Sheets (removes from Upcoming Shifts)
            await deleteShiftFromCloud(shiftId);

            // Also remove from local data
            appData.shifts = appData.shifts.filter(s => s.id !== shiftId);

            alert(result.message || 'Shift review submitted successfully!');

            // Remove from pending list
            pendingReviews = pendingReviews.filter(s => s.id !== shiftId);
            updateReviewBadge();

            // Remove the card from the modal
            card.remove();

            // If no more pending reviews, show empty state
            if (pendingReviews.length === 0) {
                const content = document.getElementById('reviewShiftsContent');
                content.innerHTML = `
                    <div class="no-pending-reviews">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                        <h4>All Caught Up!</h4>
                        <p>No completed shifts need review at this time.</p>
                    </div>
                `;
            }

            // Refresh data
            await fetchAllData();
            renderVolunteers();
            updateStats();
        } else {
            alert('Error: ' + (result.error || 'Failed to submit review'));
        }
    } catch (error) {
        console.error('Error submitting shift review:', error);
        alert('Error submitting review. Please try again.');
    }
}

// Event listener for Review Shifts button
document.getElementById('reviewShiftsBtn')?.addEventListener('click', openReviewShiftsModal);

