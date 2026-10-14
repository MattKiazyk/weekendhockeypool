import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import SubmissionDialog from '../src/components/SubmissionDialog'
import schedule from '../src/demo-nfl-schedule.json'
import type { Weekend } from '../src/lib/pool'

afterEach(() => vi.restoreAllMocks())

function renderSummary(week = schedule as Weekend) {
  return renderToStaticMarkup(
    createElement(SubmissionDialog, { week, open: true, onDismiss: () => {} }),
  )
}

it('summarizes official NFL dates in Eastern time without promising a fixed finalization date', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T12:00:00Z'))
  const summary = renderSummary()
  expect(summary).toContain('NFL Week 4')
  expect(summary).toContain('OCT 1–5')
  expect(summary).toContain('Thursday at 8:15 pm EDT')
  expect(summary).toContain('Monday, Oct 5')
  expect(summary).toContain('8:15 PM EDT')
  expect(summary).toContain('Final standings appear once every game is final or void.')
})

it('keeps the prominent invitation free of team selections and links to the saved pool', () => {
  const summary = renderSummary()
  expect(summary).toContain('https://weeklypools.ca/?league=nfl&amp;start=2026-10-01')
  expect(summary).toContain('Help Matt grow the pool')
  for (const game of schedule.games) {
    expect(summary).not.toContain(game.away.name)
    expect(summary).not.toContain(game.home.name)
  }
})
