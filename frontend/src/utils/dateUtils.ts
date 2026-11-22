/**
 * Utility functions to parse server UTC timestamps and format in Indian Standard Time (IST - Asia/Kolkata)
 */

export const parseUtcDate = (timestamp: string | Date | undefined | null): Date | null => {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  let dateStr = String(timestamp).trim();
  if (!dateStr) return null;

  // If already an ISO string with Z or +/- offset
  if (dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  // If local datetime-local format YYYY-MM-DDTHH:mm (16 chars from input)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  // Server UTC string without Z (e.g. 2026-11-17T11:00:00 or with ms)
  const d = new Date(dateStr + 'Z');
  return isNaN(d.getTime()) ? new Date(dateStr) : d;
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
