var inherits = require('util').inherits

var _ = require('lodash')

var SyncStorage = require('./SyncStorage')
var verify = require('./verify')


/**
 * @typedef {Object} ColorDataRecord
 * @property {number} colorId
 * @property {string} txId
 * @property {number} outIndex
 * @property {number} value
 */

/**
 * @class ColorDataStorage
 * @extends SyncStorage
 */
function ColorDataStorage() {
  SyncStorage.apply(this, Array.prototype.slice.call(arguments))

  this.colorTxsDBKey = this.globalPrefix + 'colorTxs'
  this.colorTxRecords = this.store.get(this.colorTxsDBKey) || []

  if (_.isUndefined(this.store.get(this.colorTxsDBKey + '_version')))
    this.store.set(this.colorTxsDBKey + '_version', '1')
}

inherits(ColorDataStorage, SyncStorage)

/**
 * @return {ColorDataRecord[]}
 */
ColorDataStorage.prototype._getRecords = function() {
  return this.colorTxRecords
}

/**
 * @param {ColorDataRecord[]}
 */
ColorDataStorage.prototype._saveRecords = function(records) {
  this.colorTxRecords = records
  this.store.set(this.colorTxsDBKey, records)
}

ColorDataStorage.prototype._eventuallySave = function() {
  var self = this
    , fn = function () {
        if (self.dirty)
          initTimeout()
        else {
          self.store.set(self.colorTxsDBKey, self.colorTxRecords)
          self.timeout = false
          self.dirty = false
        }
      }
    , initTimeout = function () {
        self.timeout = setTimeout(fn, 100);
      }
  if (!self.timeout) 
    initTimeout()
  else
    self.dirty = true;
}


/**
 * @param {ColorDataRecord} data
 * @return {ColorDataRecord}
 * @throws {Error} If exists and colorValues not equal
 */
ColorDataStorage.prototype.add = function(data, optDontSave) {
  verify.object(data)
  verify.number(data.colorId)
  verify.txId(data.txId)
  verify.number(data.outIndex)
  verify.number(data.value)

  var record = _.find(this._getRecords(), {
    colorId: data.colorId,
    txId: data.txId,
    outIndex: data.outIndex
  })
  if (!_.isUndefined(record) && record.value !== data.value)
    throw new Error('Same data exists and colorValues not equal')

  var records = this._getRecords()
  records.push({
    colorId: data.colorId,
    txId: data.txId,
    outIndex: data.outIndex,
    value: data.value
  })

  if (! optDontSave)
    this._saveRecords(records)
  else
    this.colorTxRecords = records

  return _.clone(_.last(records))
}

/**
 * @param {Object} data
 * @param {number} data.colorId
 * @param {string} data.txId
 * @param {number} data.outIndex
 * @return {?ColorDataRecord}
 */
ColorDataStorage.prototype.get = function(data) {
  verify.object(data)
  verify.number(data.colorId)
  verify.txId(data.txId)
  verify.number(data.outIndex)

  var record = _.find(this._getRecords(), {
    colorId: data.colorId,
    txId: data.txId,
    outIndex: data.outIndex
  })
  return _.isUndefined(record) ? null : _.clone(record)
}

/**
 * @param {number} [colorId]
 * @param {string} [txId]
 * @param {number} [outIndex]
 */
ColorDataStorage.prototype.remove = function(data) {
  verify.object(data)
  if (_.isUndefined(data.colorId) && _.isUndefined(data.txId) && _.isUndefined(data.outIndex))
    throw new Error('Bad data')
  if (!_.isUndefined(data.colorId)) verify.number(data.colorId)
  if (!_.isUndefined(data.txId)) verify.txId(data.txId)
  if (!_.isUndefined(data.outIndex)) verify.number(data.outIndex)

  var records = this._getRecords().filter(function(record) {
    if (!_.isUndefined(data.colorId) && record.colorId !== data.colorId) return true
    if (!_.isUndefined(data.txId) && record.txId !== data.txId) return true
    if (!_.isUndefined(data.outIndex) && record.outIndex !== data.outIndex) return true
    return false
  })
  this._saveRecords(records)
}

/**
 * Remove all colorTxs
 */
ColorDataStorage.prototype.clear = function() {
  this.store.remove(this.colorTxsDBKey)
  this.store.remove(this.colorTxsDBKey + '_version')
}


module.exports = ColorDataStorage
