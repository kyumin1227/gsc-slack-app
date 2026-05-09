import { Module } from '@nestjs/common';
import { GoogleCalendarsService } from './calendar/calendars.service';
import { GoogleAclService } from './calendar/acl.service';
import { GoogleCalendarListService } from './calendar/calendar-list.service';
import { GoogleEventsService } from './calendar/events.service';
import { GoogleChannelsService } from './calendar/channels.service';
import { GoogleFreebusyService } from './calendar/freebusy.service';
import { GoogleOAuthService } from './oauth/google-oauth.service';

const services = [
  GoogleCalendarsService,
  GoogleAclService,
  GoogleCalendarListService,
  GoogleEventsService,
  GoogleChannelsService,
  GoogleFreebusyService,
  GoogleOAuthService,
];

@Module({
  providers: services,
  exports: services,
})
export class GoogleModule {}
