import ICAL from 'ical.js';
// Adapt browser-safe ICAL.js to the existing importer, keeping validation and merge rules shared.
function parseICS(text: string) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    const id = zone.getFirstPropertyValue('tzid');
    if (typeof id === 'string') ICAL.TimezoneService.register(new ICAL.Timezone(zone), id);
  }
  const result: Record<string, any> = {};
  root.getAllSubcomponents('vevent').forEach((component, index) => {
    const event = new ICAL.Event(component);
    if (!component.hasProperty('dtstart')) return;
    result[String(index)] = {
      type: 'VEVENT', start: event.startDate.toJSDate(), end: event.endDate.toJSDate(),
      summary: event.summary, location: event.location, description: event.description,
      datetype: event.startDate.isDate ? 'date' : 'date-time',
      'SCHEDULE-COPILOT': component.getFirstPropertyValue('x-schedule-copilot'),
      rrule: event.isRecurring() ? { between(from: Date, to: Date) {
        const dates: Date[] = [], iterator = event.iterator();
        for (let count = 0; count < 20000; count++) {
          const next = iterator.next(); if (!next) break;
          const date = next.toJSDate(); if (date > to) break;
          if (date >= from) dates.push(date);
        }
        return dates;
      } } : undefined,
    };
  });
  return result;
}
export default { sync: { parseICS } };
