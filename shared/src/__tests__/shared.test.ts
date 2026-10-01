import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMAN_ALLOWED_TRANSITIONS,
  TicketPriority,
  TicketStatus,
  TransitionActor,
  compareTickets,
  isTransitionAllowed,
  ticketSubject,
  ticketTitle,
} from '../index';

test('ticketTitle falls back to the first description line when untitled', () => {
  assert.equal(ticketTitle({ title: ' Fix login ', description: 'd' }), 'Fix login');
  assert.equal(ticketTitle({ title: '', description: '\n## Checkout total is wrong\nmore' }), 'Checkout total is wrong');
  assert.equal(ticketTitle({ title: '', description: 'x'.repeat(300) }).length, 120);
});

test('ticketSubject omits the title when there is none', () => {
  assert.equal(ticketSubject({ number: 3, title: 'Fix login' }), '#3: Fix login');
  assert.equal(ticketSubject({ number: 3, title: '  ' }), '#3');
});

test('compareTickets orders by priority, then position, then createdAt', () => {
  const tickets = [
    { id: 'low', priority: TicketPriority.Low, position: 0, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'med2', priority: TicketPriority.Medium, position: 2, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'urgent', priority: TicketPriority.Urgent, position: 9, createdAt: '2026-01-03T00:00:00Z' },
    { id: 'med1b', priority: TicketPriority.Medium, position: 1, createdAt: '2026-01-02T00:00:00Z' },
    { id: 'med1a', priority: TicketPriority.Medium, position: 1, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'high', priority: TicketPriority.High, position: 5, createdAt: '2026-01-01T00:00:00Z' },
  ];
  const order = [...tickets].sort(compareTickets).map((t) => t.id);
  assert.deepEqual(order, ['urgent', 'high', 'med1a', 'med1b', 'med2', 'low']);
});

test('only the worker moves tickets into in_progress', () => {
  assert.equal(isTransitionAllowed(TicketStatus.Pending, TicketStatus.InProgress, TransitionActor.Worker), true);
  assert.equal(isTransitionAllowed(TicketStatus.Pending, TicketStatus.InProgress, TransitionActor.Human), false);
});

test('done cannot be cancelled', () => {
  assert.deepEqual(HUMAN_ALLOWED_TRANSITIONS[TicketStatus.Done], []);
  assert.ok(HUMAN_ALLOWED_TRANSITIONS[TicketStatus.Review].includes(TicketStatus.Done));
});
