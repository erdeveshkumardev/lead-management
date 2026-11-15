/**
 * Utility functions to parse server UTC timestamps and format in Indian Standard Time (IST - Asia/Kolkata)
 */

export const parseUtcDate = (timestamp: string | Date | undefined | null): Date | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  let dateStr = String(timestamp).trim();
  // If no timezone offset (+/-HH:MM) or trailing 'Z' is present, append 'Z' so browser treats it as UTC
  if (!dateStr.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
    dateStr += 'Z';
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
};

export const formatIndianDateTime = (
  timestamp: string | Date | undefined | null,
  includeTimezoneBadge = true
): string => {
  const d = parseUtcDate(timestamp);
  if (!d) return 'N/A';

  const formatted = d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return includeTimezoneBadge ? `${formatted} IST` : formatted;
};

export const formatIndianDate = (timestamp: string | Date | undefined | null): string => {
  const d = parseUtcDate(timestamp);
  if (!d) return 'N/A';

  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};
