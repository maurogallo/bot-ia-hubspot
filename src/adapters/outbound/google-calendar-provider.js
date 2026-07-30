const { google } = require('googleapis');
const logger = require('../logger');

function createProvider(config) {
  let calendar = null;

  function getAuth() {
    if (!config.clientEmail || !config.privateKey) return null;
    return new google.auth.JWT(
      config.clientEmail,
      null,
      config.privateKey,
      ['https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly']
    );
  }

  function getCalendar() {
    if (calendar) return calendar;
    const auth = getAuth();
    if (!auth) return null;
    calendar = google.calendar({ version: 'v3', auth });
    return calendar;
  }

  async function checkHealth() {
    try {
      const cal = getCalendar();
      if (!cal) return { available: false, reason: 'not configured' };
      await cal.settings.list({ timeout: 5000 });
      return { available: true };
    } catch (err) {
      logger.warn('Calendar health check failed', { error: err.message });
      return { available: false, reason: err.message };
    }
  }

  function buildTimeSlots(dateStr, timezone, duration, busyIntervals) {
    const tz = timezone || config.timezone || 'America/Argentina/Buenos_Aires';
    const dur = duration || config.meetingDuration || 30;
    const targetDate = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = targetDate.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) return [];

    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const busySet = new Set();
    for (const interval of busyIntervals) {
      const start = new Date(interval.start).getTime();
      const end = new Date(interval.end).getTime();
      const cursor = start;
      while (cursor < end) {
        busySet.add(cursor);
        cursor += 15 * 60 * 1000;
      }
    }

    const slots = [];
    const startHour = 9;
    const endHour = 18;
    const now = Date.now();
    const cushion = 30 * 60 * 1000;

    for (let h = startHour; h < endHour; h++) {
      for (let m = 0; m < 60; m += 30) {
        const slotDate = new Date(dateStr + `T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
        const slotTime = slotDate.getTime();
        const slotEnd = slotTime + dur * 60 * 1000;

        if (slotTime < now + cushion) continue;

        let blocked = false;
        for (let t = slotTime; t < slotEnd && !blocked; t += 15 * 60 * 1000) {
          if (busySet.has(t)) blocked = true;
        }
        if (blocked) continue;

        const startStr = formatter.format(slotDate).replace(' ', 'T');
        const endStr = formatter.format(new Date(slotEnd)).replace(' ', 'T');

        slots.push({
          start: slotDate.toISOString(),
          end: new Date(slotEnd).toISOString(),
          label: new Intl.DateTimeFormat('es-ES', {
            timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true,
          }).format(slotDate),
          value: startStr,
        });
      }
    }

    return slots;
  }

  async function getAvailability(dateStr) {
    const cal = getCalendar();
    if (!cal) throw new Error('Calendar not configured');

    const tz = config.timezone || 'America/Argentina/Buenos_Aires';

    try {
      const body = {
        timeMin: new Date(dateStr + 'T00:00:00').toISOString(),
        timeMax: new Date(dateStr + 'T23:59:59').toISOString(),
        timeZone: tz,
        items: [{ id: config.calendarId || 'primary' }],
      };

      const response = await cal.freebusy.query({ requestBody: body, timeout: 10000 });
      const busy = response.data.calendars?.[config.calendarId || 'primary']?.busy || [];
      const slots = buildTimeSlots(dateStr, tz, config.meetingDuration, busy);

      logger.info('Availability checked', { date: dateStr, slots: slots.length });
      return { date: dateStr, timezone: tz, slots };
    } catch (error) {
      logger.error('Calendar availability error', { error: error.message, date: dateStr });
      throw error;
    }
  }

  async function bookAppointment(name, email, startTimeISO, duration = null) {
    const cal = getCalendar();
    if (!cal) throw new Error('Calendar not configured');

    const dur = duration || config.meetingDuration || 30;
    const tz = config.timezone || 'America/Argentina/Buenos_Aires';

    const startDate = new Date(startTimeISO);
    const endDate = new Date(startDate.getTime() + dur * 60 * 1000);

    try {
      const event = {
        summary: name ? `Reunion - ${name}` : 'Reunion',
        description: 'Reunion agendada via bot IA',
        start: { dateTime: startDate.toISOString(), timeZone: tz },
        end: { dateTime: endDate.toISOString(), timeZone: tz },
        attendees: [{ email, displayName: name }],
        conferenceData: {
          createRequest: { requestId: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
        reminders: { useDefault: false, overrides: [
          { method: 'email', minutes: 60 },
          { method: 'popup', minutes: 10 },
        ] },
      };

      const response = await cal.events.insert({
        calendarId: config.calendarId || 'primary',
        conferenceDataVersion: 1,
        sendUpdates: 'all',
        requestBody: event,
        timeout: 15000,
      });

      const created = response.data;
      logger.info('Appointment booked', {
        email, startTime: startDate.toISOString(), eventId: created.id,
      });

      return {
        id: created.id,
        htmlLink: created.htmlLink,
        hangoutLink: created.hangoutLink,
        start: created.start.dateTime,
        end: created.end.dateTime,
      };
    } catch (error) {
      logger.error('Calendar booking error', { error: error.message, email });
      throw error;
    }
  }

  async function getScheduledAppointments(email) {
    const cal = getCalendar();
    if (!cal) throw new Error('Calendar not configured');

    try {
      const response = await cal.events.list({
        calendarId: config.calendarId || 'primary',
        q: email,
        timeMin: new Date().toISOString(),
        maxResults: 20,
        singleEvents: true,
        orderBy: 'startTime',
        timeout: 10000,
      });

      return (response.data.items || []).map(e => ({
        id: e.id,
        summary: e.summary,
        start: e.start.dateTime || e.start.date,
        end: e.end.dateTime || e.end.date,
        htmlLink: e.htmlLink,
        hangoutLink: e.hangoutLink,
        attendees: (e.attendees || []).map(a => a.email),
      }));
    } catch (error) {
      logger.error('Calendar list error', { error: error.message, email });
      throw error;
    }
  }

  async function cancelEvent(eventId) {
    const cal = getCalendar();
    if (!cal) throw new Error('Calendar not configured');

    try {
      await cal.events.delete({
        calendarId: config.calendarId || 'primary',
        eventId,
        sendUpdates: 'all',
        timeout: 10000,
      });
      logger.info('Calendar event cancelled', { eventId });
    } catch (error) {
      logger.error('Calendar cancel error', { error: error.message, eventId });
      throw error;
    }
  }

  return { checkHealth, getAvailability, bookAppointment, getScheduledAppointments, cancelEvent };
}

module.exports = { createProvider };
