// ================================================================
// UNIT TESTS — Email Service
// ================================================================
// Tests the email template generation and task filtering logic
// without actually sending emails (no network calls).
// ================================================================

const {
  formatSummaryEmail,
  formatPersonalizedEmail,
  generateICalEvent,
} = require('../services/emailService');

describe('Email Service', () => {

  // ── Template Generation ────────────────────────────────────────
  describe('formatSummaryEmail', () => {
    it('should generate valid HTML with summary data', () => {
      const summary = {
        executive_summary: 'Team discussed Q2 roadmap',
        sentiment: 'positive',
        key_decisions: ['Launch dashboard by June 1st'],
      };
      const tasks = [
        { description: 'Complete API integration', assignee: 'Speaker 1', priority: 'high' },
      ];

      const html = formatSummaryEmail(summary, tasks, [], {});

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Team discussed Q2 roadmap');
      expect(html).toContain('Complete API integration');
      expect(html).toContain('Speaker 1');
      expect(html).toContain('Launch dashboard by June 1st');
    });

    it('should handle null/empty data gracefully', () => {
      const html = formatSummaryEmail(null, [], [], {});

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Meeting Summary');
      expect(html).not.toContain('undefined');
    });

    it('should show correct sentiment color', () => {
      const positive = formatSummaryEmail({ sentiment: 'positive' }, [], [], {});
      const negative = formatSummaryEmail({ sentiment: 'negative' }, [], [], {});

      expect(positive).toContain('#10b981'); // green
      expect(negative).toContain('#ef4444'); // red
    });
  });

  // ── Personalized Email ─────────────────────────────────────────
  describe('formatPersonalizedEmail', () => {
    it('should show only the recipient\'s tasks', () => {
      const allTasks = [
        { description: 'Write docs', assignee: 'Alice', priority: 'high' },
        { description: 'Fix bugs', assignee: 'Bob', priority: 'normal' },
        { description: 'Deploy app', assignee: 'Alice', priority: 'urgent' },
      ];

      const myTasks = allTasks.filter(t => t.assignee === 'Alice');

      const html = formatPersonalizedEmail({
        recipientName: 'Alice',
        myTasks,
        allTasks,
        summary: { executive_summary: 'Sprint review meeting' },
        sessionTitle: 'Sprint Review',
      });

      expect(html).toContain('Alice');
      expect(html).toContain('Write docs');
      expect(html).toContain('Deploy app');
      expect(html).toContain('Your Action Items (2)');
      // Bob's task should appear in team overview, not in "Your Tasks"
      expect(html).toContain('Bob');
      expect(html).toContain('Fix bugs');
    });

    it('should show "No tasks assigned" when recipient has none', () => {
      const html = formatPersonalizedEmail({
        recipientName: 'Charlie',
        myTasks: [],
        allTasks: [],
        summary: {},
        sessionTitle: 'Standup',
      });

      expect(html).toContain('No tasks assigned');
    });

    it('should include next meeting section when provided', () => {
      const html = formatPersonalizedEmail({
        recipientName: 'Alice',
        myTasks: [],
        allTasks: [],
        summary: {},
        sessionTitle: 'Standup',
        nextMeeting: { date: '2026-05-20', time: '3:00 PM', agenda: 'Sprint planning' },
      });

      expect(html).toContain('Next Meeting');
      expect(html).toContain('Sprint planning');
    });
  });

  // ── iCal Generation ────────────────────────────────────────────
  describe('generateICalEvent', () => {
    it('should generate valid iCal for task with deadline', () => {
      const task = {
        task_id: 'test-123',
        description: 'Complete API integration',
        deadline: '2026-06-01T00:00:00Z',
        priority: 'high',
      };

      const ical = generateICalEvent(task, 'test@pine.ai');

      expect(ical).toContain('BEGIN:VCALENDAR');
      expect(ical).toContain('END:VCALENDAR');
      expect(ical).toContain('Complete API integration');
      expect(ical).toContain('PRIORITY:1'); // high = 1
      expect(ical).toContain('test-123@pine.ai');
    });

    it('should return null when no deadline', () => {
      const task = { description: 'Some task' };
      const ical = generateICalEvent(task, 'test@pine.ai');
      expect(ical).toBeNull();
    });

    it('should set correct priority values', () => {
      const high = generateICalEvent(
        { description: 'Task', deadline: '2026-06-01', priority: 'high' },
        'test@pine.ai'
      );
      const medium = generateICalEvent(
        { description: 'Task', deadline: '2026-06-01', priority: 'medium' },
        'test@pine.ai'
      );
      const low = generateICalEvent(
        { description: 'Task', deadline: '2026-06-01', priority: 'low' },
        'test@pine.ai'
      );

      expect(high).toContain('PRIORITY:1');
      expect(medium).toContain('PRIORITY:5');
      expect(low).toContain('PRIORITY:9');
    });
  });
});
