import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildHolidayDataset,
  parseHolidayCsv,
  validateHolidayDatasetUpdate
} from './holidays-lib.mjs'

const manyRows = Array.from({ length: 1_001 }, (_, index) => {
  const year = 2000 + Math.floor(index / 365)
  const dayOfYear = index % 365
  const date = new Date(Date.UTC(year, 0, dayOfYear + 1))
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()},祝日${index}`
})
const fixture = `国民の祝日・休日月日,国民の祝日・休日名称\n${manyRows.join('\n')}\n`

test('内閣府CSVをISO日付の祝日データへ変換する', () => {
  const dataset = buildHolidayDataset(fixture)
  assert.equal(dataset.schemaVersion, 1)
  assert.equal(dataset.recordCount, 1_001)
  assert.equal(dataset.holidays['2000-01-01'], '祝日0')
  assert.equal(dataset.coveredThrough, '2002-09-28')
})

test('不正なヘッダーと重複日付を拒否する', () => {
  assert.throws(() => parseHolidayCsv(fixture.replace('国民の祝日・休日月日', '日付')))
  const duplicateFixture = `${fixture}2000/1/1,重複\n`
  assert.throws(() => parseHolidayCsv(duplicateFixture), /重複/)
})

test('更新で件数・収録期限・既存日付が失われる場合は拒否する', () => {
  const current = buildHolidayDataset(fixture)
  const added = structuredClone(current)
  added.recordCount += 1
  added.coveredThrough = '2027-01-01'
  added.holidays['2027-01-01'] = '追加の祝日'
  assert.doesNotThrow(() => validateHolidayDatasetUpdate(current, added))

  const fewer = structuredClone(current)
  fewer.recordCount -= 1
  assert.throws(() => validateHolidayDatasetUpdate(current, fewer), /件数が減少/)

  const earlier = structuredClone(current)
  earlier.coveredThrough = '2000-01-01'
  assert.throws(() => validateHolidayDatasetUpdate(current, earlier), /収録期限が後退/)

  const missing = structuredClone(current)
  delete missing.holidays['2000-01-01']
  assert.throws(() => validateHolidayDatasetUpdate(current, missing), /既存の祝日.*欠落/)
})
