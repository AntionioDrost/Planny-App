import * as XLSX from 'xlsx';

export interface WeeklyWebRequirement {
  webShifts: number;
  webShiftDays: string[];
  webShiftTimePreference: 'Morning' | 'Afternoon' | 'Any';
  webRevisionShifts: number;
  webRevisionDays: string[];
  webRevisionTimePreference: 'Morning' | 'Afternoon' | 'Any';
}

export interface ParsedData {
  days: string[];
  closedDays: string[];
  employees: EmployeeData[];
  weeklyWebRequirements: Record<string, WeeklyWebRequirement>;
  rosterYear: number | null;
}

export interface EmployeeData {
  name: string;
  availability: Record<string, string>;
  isWeb: boolean;
  isWebRevision?: boolean;
  isWebOnly?: boolean;
  preferredHours: number;
  maxHours: number;
  weeklyPreferredHoursOverride: Record<string, number | null>;
  weeklyMaxHoursOverride: Record<string, number | null>;
  fullDayPriority: number;
}

export async function parseExcel(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        let headerRowIndex = -1;
        let nameColIndex = -1;

        // Find header row
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          for (let j = 0; j < row.length; j++) {
            if (typeof row[j] === 'string' && row[j].trim().toLowerCase() === 'name') {
              headerRowIndex = i;
              nameColIndex = j;
              break;
            }
          }
          if (headerRowIndex !== -1) break;
        }

        if (headerRowIndex === -1) {
          throw new Error('Could not find a column named "Name"');
        }

        const headerRow = rows[headerRowIndex];
        const days: string[] = [];
        const closedDays: string[] = [];
        const dayColIndices: number[] = [];
        const weeks = new Set<string>();

        // Find the last columns to check if they are preferred/max hours columns
        let prefHoursColIndex = -1;
        let maxHoursColIndex = -1;
        
        // Search headers for "preferred" and "max"
        for (let j = nameColIndex + 1; j < headerRow.length; j++) {
          if (!headerRow[j]) continue;
          const headerStr = headerRow[j].toString().toLowerCase();
          if (headerStr.includes('preferred') || headerStr === 'pref') {
            prefHoursColIndex = j;
          } else if (headerStr.includes('max')) {
            maxHoursColIndex = j;
          }
        }

        // Fallback: if not found by name, check the last two columns
        if (prefHoursColIndex === -1 || maxHoursColIndex === -1) {
          const lastCols: number[] = [];
          for (let j = headerRow.length - 1; j > nameColIndex; j--) {
            if (headerRow[j] && headerRow[j].toString().trim() !== '') {
              lastCols.push(j);
              if (lastCols.length === 2) break;
            }
          }
          
          if (lastCols.length >= 1) {
            const colIdx = lastCols[lastCols.length - 1]; // The one further to the left
            const headerStr = headerRow[colIdx].toString().toLowerCase();
            const isDayFormat = /^\[.*?\]/.test(headerStr) || 
                                /maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(headerStr);
            
            if (!isDayFormat || headerStr.includes('uur') || headerStr.includes('uren') || headerStr.includes('hour') || headerStr.includes('contract')) {
              if (lastCols.length === 2) {
                prefHoursColIndex = lastCols[1];
                maxHoursColIndex = lastCols[0];
              } else {
                prefHoursColIndex = lastCols[0];
              }
            }
          }
        }

        for (let j = nameColIndex + 1; j < headerRow.length; j++) {
          if (j === prefHoursColIndex || j === maxHoursColIndex) continue; // Skip the hours columns

          if (headerRow[j]) {
            const dayStr = headerRow[j].toString();
            days.push(dayStr);
            dayColIndices.push(j);
            
            if (dayStr.toUpperCase().includes('OFFICE CLOSED') || dayStr.toUpperCase().includes('GESLOTEN')) {
              closedDays.push(dayStr);
            }

            const match = dayStr.match(/^\[(.*?)\]/);
            if (match) {
              weeks.add(match[1]);
            } else {
              weeks.add('default');
            }
          }
        }

        const employees: EmployeeData[] = [];
        let isWebSection = false;
        const webNames = new Set<string>();
        
        // Parse rows below header
        for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          const nameCell = row[nameColIndex];

          if (!nameCell) continue;

          const nameStr = nameCell.toString().trim();

          if (nameStr.toUpperCase().startsWith('WEB:')) {
            isWebSection = true;
            continue;
          }

          if (isWebSection) {
            webNames.add(nameStr);
          } else {
            // It's an employee row
            const availability: Record<string, string> = {};
            for (let k = 0; k < days.length; k++) {
              const day = days[k];
              const colIdx = dayColIndices[k];
              const val = row[colIdx];
              if (val) {
                availability[day] = val.toString().trim();
              }
            }
            const weeklyPreferredHoursOverride: Record<string, number | null> = {};
            const weeklyMaxHoursOverride: Record<string, number | null> = {};
            for (const week of weeks) {
              weeklyPreferredHoursOverride[week] = null;
              weeklyMaxHoursOverride[week] = null;
            }
            
            let preferredHours = 32; // Default preferred hours
            let maxHours = 40; // Default max hours
            
            if (prefHoursColIndex !== -1) {
              const prefVal = row[prefHoursColIndex];
              if (prefVal !== undefined && prefVal !== null && prefVal !== '') {
                const parsed = parseFloat(prefVal.toString().replace(',', '.'));
                if (!isNaN(parsed)) preferredHours = parsed;
              }
            }
            
            if (maxHoursColIndex !== -1) {
              const maxVal = row[maxHoursColIndex];
              if (maxVal !== undefined && maxVal !== null && maxVal !== '') {
                const parsed = parseFloat(maxVal.toString().replace(',', '.'));
                if (!isNaN(parsed)) maxHours = parsed;
              } else {
                maxHours = preferredHours; // Fallback to preferred if max is empty
              }
            } else {
              maxHours = preferredHours; // Fallback to preferred if max column doesn't exist
            }

            employees.push({
              name: nameStr,
              availability,
              isWeb: false,
              isWebRevision: false,
              isWebOnly: false,
              preferredHours,
              maxHours,
              weeklyPreferredHoursOverride,
              weeklyMaxHoursOverride,
              fullDayPriority: 0,
            });
          }
        }

        // Mark web employees
        for (const emp of employees) {
          if (webNames.has(emp.name)) {
            emp.isWeb = true;
          }
        }

        // Initialize weeklyWebRequirements
        const weeklyWebRequirements: Record<string, WeeklyWebRequirement> = {};
        for (const week of weeks) {
          weeklyWebRequirements[week] = {
            webShifts: 0,
            webShiftDays: [],
            webShiftTimePreference: 'Afternoon',
            webRevisionShifts: 0,
            webRevisionDays: [],
            webRevisionTimePreference: 'Afternoon'
          };
        }

        resolve({ 
          days, 
          closedDays,
          employees, 
          weeklyWebRequirements,
          rosterYear: null,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
