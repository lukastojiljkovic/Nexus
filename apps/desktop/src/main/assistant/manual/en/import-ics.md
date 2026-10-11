---
id: import-ics
title: Import a calendar (.ics)
location: { module: settings, settings: data }
keywords: [import, calendar, ics, google calendar, outlook, events]
---
Importing a calendar reads an .ics file — an export from Google Calendar, Outlook or any app that makes one — and adds the events alongside the ones you already have.

How to import:

1. Under "Import and export" open "Import a calendar (.ics)" and click "Choose an .ics file…".
2. Click "Show a preview" and read the columns "In the file" and "Importing" on the "Events" row.
3. If some events are already in the calendar you either skip them or import anyway.
4. Click "Import". The import can be undone with one click, but only until you lock or close the app.

What is not carried over: reminders (the alarms are counted and left behind), a recurrence rule Nexus does not have (only the first occurrence arrives, as a one-off event), time zones this computer does not know (such an event is skipped), an event with no title, and content that is not an event (a VTODO, say). A time written in another zone is recalculated to this computer's clock.

Limits: the file must be iCalendar; if it is not, the import is refused ("This file is not an iCalendar (.ics) calendar."). Everything that does not make it is written out, piece by piece, in the preview before the import.

Related: calendar, export-ics
