'use client';

import { Briefcase, CalendarDays, ChevronRight, Clock, MapPin, RefreshCw } from 'lucide-react';

import type { DashboardAppointment, DashboardResult, DashboardView } from '@/types/dashboard';
import { formatAddress, formatShortDate, formatTime, formatWindow, isCanceled, localDateOf, nextAppointmentId, statusTone } from './format';
import { Skeleton, UnavailableNotice } from './Notice';

interface TimelineProps {
  data: DashboardResult | null;
  loading: boolean;
  error: string | null;
  view: DashboardView;
  date: string | null;
  onViewChange: (view: DashboardView, date?: string) => void;
  onRefresh: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenJob: (id: string) => void;
}

export function StatusChip({ status }: { status: string | null }) {
  return <span className={`cmtplay-chip cmtplay-chip--${statusTone(status)}`}>{status ?? 'Status unavailable'}</span>;
}

export function AppointmentCard({
  appointment,
  timezone,
  order,
  selected,
  isNext,
  onSelect,
  onOpenJob,
}: {
  appointment: DashboardAppointment;
  timezone: string;
  order: number;
  selected: boolean;
  isNext: boolean;
  onSelect: (id: string) => void;
  onOpenJob: (id: string) => void;
}) {
  const address = formatAddress(appointment.address);
  const canceled = isCanceled(appointment);
  return (
    <li className={`cmtplay-tl-item${selected ? ' is-selected' : ''}${canceled ? ' is-canceled' : ''}`} data-appointment-id={appointment.id}>
      <div className="cmtplay-tl-rail" aria-hidden="true">
        <span className="cmtplay-tl-time">{formatTime(appointment.scheduledStart, timezone)}</span>
        <span className="cmtplay-tl-dot">{order}</span>
      </div>
      <article className="cmtplay-tl-card">
        <button type="button" className="cmtplay-tl-select" aria-pressed={selected} onClick={() => onSelect(appointment.id)}>
          <span className="cmtplay-tl-top">
            <span className="cmtplay-tl-num">{appointment.appointmentNumber ?? 'No number'}</span>
            {isNext ? <span className="cmtplay-next">Next</span> : null}
            <StatusChip status={appointment.status} />
          </span>
          <span className="cmtplay-tl-subject">{appointment.subject ?? 'No subject'}</span>
          <span className="cmtplay-tl-meta">
            <Briefcase size={14} aria-hidden="true" />
            {appointment.customerName ?? 'Customer unavailable'}
          </span>
          <span className="cmtplay-tl-meta">
            <Clock size={14} aria-hidden="true" />
            {formatWindow(appointment.scheduledStart, appointment.scheduledEnd, timezone)}
          </span>
          <span className="cmtplay-tl-meta">
            <MapPin size={14} aria-hidden="true" />
            {address ?? 'Address unavailable'}
          </span>
        </button>
        <button type="button" className="cmtplay-tl-open" onClick={() => onOpenJob(appointment.id)}>
          Open job <ChevronRight size={16} aria-hidden="true" />
        </button>
      </article>
    </li>
  );
}

export default function Timeline({ data, loading, error, view, date, onViewChange, onRefresh, selectedId, onSelect, onOpenJob }: TimelineProps) {
  const ok = data?.status === 'ok' ? data : null;
  const nextId = ok ? nextAppointmentId(ok.appointments) : null;

  // Group by local date for the week view.
  const groups: Array<{ date: string; items: DashboardAppointment[] }> = [];
  if (ok) {
    for (const appointment of ok.appointments) {
      const day = appointment.scheduledStart ? localDateOf(appointment.scheduledStart, ok.timezone) : 'unscheduled';
      const group = groups.find((candidate) => candidate.date === day);
      if (group) group.items.push(appointment);
      else groups.push({ date: day, items: [appointment] });
    }
  }

  let order = 0;

  return (
    <section className="cmtplay-card cmtplay-timeline" aria-labelledby="cmtplay-tl-title">
      <header className="cmtplay-card-head">
        <div>
          <h2 id="cmtplay-tl-title" className="cmtplay-card-title">
            <CalendarDays size={18} aria-hidden="true" /> {view === 'week' ? "This Week's Route" : view === 'date' ? 'Route for Selected Date' : "Today's Route"}
          </h2>
          {ok ? (
            <p className="cmtplay-card-sub">
              {ok.appointmentCount}
              {ok.countIsLowerBound ? '+' : ''} {ok.appointmentCount === 1 ? 'appointment' : 'appointments'}
            </p>
          ) : null}
        </div>
        <button type="button" className="cmtplay-icon-btn" onClick={onRefresh} disabled={loading} aria-label="Refresh appointments">
          <RefreshCw size={17} className={loading ? 'cmtplay-spin' : undefined} />
        </button>
      </header>

      <div className="cmtplay-segment" role="group" aria-label="Choose period">
        {(['today', 'week'] as const).map((option) => (
          <button key={option} type="button" aria-pressed={view === option} onClick={() => onViewChange(option)}>
            {option === 'today' ? 'Today' : 'Week'}
          </button>
        ))}
        <label className={`cmtplay-date-pick${view === 'date' ? ' is-active' : ''}`}>
          <span className="cmtplay-sr">Selected date</span>
          <input type="date" value={view === 'date' && date ? date : ''} onChange={(event) => event.target.value && onViewChange('date', event.target.value)} />
        </label>
      </div>

      <div className="cmtplay-tl-body" aria-busy={loading}>
        {error ? <UnavailableNotice state={{ status: 'unavailable', code: 'salesforce_error', message: error }} /> : null}
        {!error && loading && !data ? <Skeleton lines={5} /> : null}
        {!error && data?.status === 'unavailable' ? <UnavailableNotice state={data} /> : null}
        {ok && ok.countIsLowerBound ? (
          <p className="cmtplay-inline-warn">More than 100 appointments matched; only the first 100 are listed and the total could not be confirmed.</p>
        ) : null}
        {ok && ok.verifiedTotal !== null && ok.verifiedTotal > ok.appointments.length ? (
          <p className="cmtplay-inline-warn">
            Showing the first {ok.appointments.length} of {ok.verifiedTotal} assignments (the Named Query returns at most 100).
          </p>
        ) : null}
        {ok && ok.appointments.length === 0 ? (
          <div className="cmtplay-empty">
            <CalendarDays size={28} aria-hidden="true" />
            <p className="cmtplay-empty-title">No appointments</p>
            <p>Nothing is assigned to you {view === 'today' ? 'today' : view === 'week' ? 'this week' : 'on this date'}.</p>
          </div>
        ) : null}
        {ok && ok.appointments.length > 0 ? (
          groups.map((group) => (
            <div key={group.date} className="cmtplay-tl-group">
              {view !== 'today' ? <h3 className="cmtplay-tl-day">{group.date === 'unscheduled' ? 'Unscheduled' : formatShortDate(group.date)}</h3> : null}
              <ol className="cmtplay-tl-list">
                {group.items.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    timezone={ok.timezone}
                    order={++order}
                    selected={appointment.id === selectedId}
                    isNext={appointment.id === nextId}
                    onSelect={onSelect}
                    onOpenJob={onOpenJob}
                  />
                ))}
              </ol>
            </div>
          ))
        ) : null}
        {ok?.customerLookup === 'unavailable' && ok.appointments.length > 0 ? (
          <p className="cmtplay-inline-note">Customer names could not be loaded from Salesforce.</p>
        ) : null}
      </div>
    </section>
  );
}
