// ================================================================
// CALENDAR SERVICE
// ================================================================
// Generates Google Calendar event creation URLs from task data.
// Uses the free URL scheme — no API key needed.
//
// URL format:
//   https://calendar.google.com/calendar/event?action=TEMPLATE
//   &text=<title>&dates=<start>/<end>&details=<description>
// ================================================================

/**
 * Build a Google Calendar "Add Event" URL from a task object.
 *
 * @param {Object} task - { description, assignee, deadline, priority }
 * @param {string} meetingTitle - Original meeting title for context
 * @returns {string|null} - Calendar URL, or null if no deadline
 */
const buildCalendarUrl = (task, meetingTitle = '') => {
  if (!task.deadline) return null;

  const title = (task.description || 'Task').substring(0, 120);
  const details = [
    task.assignee ? `Assigned to: ${task.assignee}` : '',
    task.priority ? `Priority: ${task.priority}` : '',
    meetingTitle ? `\nFrom meeting: ${meetingTitle}` : '',
    '\n\nCreated by Pine.AI',
  ]
    .filter(Boolean)
    .join('\n');

  const deadline = new Date(task.deadline);

  // Format dates as YYYYMMDDTHHmmssZ
  const formatDate = (d) =>
    d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const start = formatDate(deadline);
  // Default 1 hour duration
  const end = formatDate(new Date(deadline.getTime() + 60 * 60 * 1000));

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${start}/${end}`,
    details: details,
  });

  return `https://calendar.google.com/calendar/event?${params.toString()}`;
};

/**
 * Generate calendar URLs for all tasks with deadlines in a session.
 *
 * @param {Array} tasks - Array of task objects
 * @param {string} meetingTitle - Meeting title for context
 * @returns {Array} - Tasks enriched with calendarUrl property
 */
const enrichTasksWithCalendarUrls = (tasks, meetingTitle = '') => {
  return (tasks || []).map((task) => ({
    ...task,
    calendarUrl: buildCalendarUrl(task, meetingTitle),
  }));
};

/**
 * Generate an iCal (.ics) string for a task.
 *
 * @param {Object} task - { description, assignee, deadline, priority }
 * @param {string} meetingTitle
 * @returns {string|null} - iCal content string, or null
 */
const generateICalString = (task, meetingTitle = '') => {
  if (!task.deadline) return null;

  const deadline = new Date(task.deadline);
  const formatDate = (d) =>
    d.toISOString().replace(/[-:.]/g, '').substring(0, 15) + 'Z';

  const start = formatDate(deadline);
  const end = formatDate(new Date(deadline.getTime() + 60 * 60 * 1000));
  const now = formatDate(new Date());

  const description = [
    task.assignee ? `Assigned to: ${task.assignee}` : '',
    task.priority ? `Priority: ${task.priority}` : '',
    meetingTitle ? `From meeting: ${meetingTitle}` : '',
  ]
    .filter(Boolean)
    .join('\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pine.AI//Meeting Tasks//EN',
    'BEGIN:VEVENT',
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${(task.description || 'Task').substring(0, 120)}`,
    `DESCRIPTION:${description}`,
    `STATUS:NEEDS-ACTION`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};

module.exports = {
  buildCalendarUrl,
  enrichTasksWithCalendarUrls,
  generateICalString,
};
