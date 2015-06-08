var _ = require('lodash')
var inherits = require('util').inherits
var events = require('events')
var timers = require('timers')
var Promise = require('bluebird')

var GenesisColorDefinition = require('./genesis')
var UncoloredColorDefinition = require('./uncolored')
var errors = require('../errors')

/**
 * @event ColorDefinitionManager#new
 * @param {defintions.IColorDefinition} cdef
 */

/**
 * @class ColorDefinitionManager
 * @extends events.EventEmitter
 * @param {IColorDefinitionStorage} storage
 */
function ColorDefinitionManager (storage) {
  events.EventEmitter.call(this)

  this._storage = storage
  this._uncolored = new UncoloredColorDefinition()
}

inherits(ColorDefinitionManager, events.EventEmitter)

ColorDefinitionManager._cd_classes = {}

/**
 * @return {UncoloredColorDefinition}
 */
ColorDefinitionManager.getUncolored = function () {
  return new UncoloredColorDefinition()
}

/**
 * @return {GenesisColorDefinition}
 */
ColorDefinitionManager.getGenesis = function () {
  return new GenesisColorDefinition()
}

/**
 * @param {IColorDefinition} cls
 * @throws {AlreadyRegistered}
 */
ColorDefinitionManager.registerColorDefinitionClass = function (cls) {
  var clsColorCode = cls.getColorCode()

  if (ColorDefinitionManager._cd_classes[clsColorCode] !== undefined) {
    throw new errors.ColorDefinition.AlreadyRegistered(clsColorCode, cls.name)
  }

  ColorDefinitionManager._cd_classes[clsColorCode] = cls
}

/**
 * @return {function[]}
 */
ColorDefinitionManager.getColorDefinitionClasses = function () {
  return _.values(ColorDefinitionManager._cd_classes)
}

/**
 * @param {string} code
 * @return {?function}
 */
ColorDefinitionManager.getColorDefinitionClass = function (code) {
  return ColorDefinitionManager._cd_classes[code] || null
}

/**
 * @private
 * @param {IColorDefinitionStorage~Record} record
 * @return {Promise.<?ColorDefinition>}
 */
ColorDefinitionManager.prototype._record2ColorDefinition = function (record) {
  var code = record.desc.split(':')[0]
  var Cls = ColorDefinitionManager.getColorDefinitionClass(code)

  try {
    return Cls.fromDesc(record.desc, record.id)
  } catch (err) {}

  return Promise.resolve(null)
}

/**
 * Return ColorDefinition instance if desc in store.
 *  Otherwise if autoAdd is true creates new ColorDefinition, add to store
 *    and return it
 *
 * @param {string} desc
 * @param {Object} [opts]
 * @param {boolean} [opts.autoAdd=true]
 * @return {Promise.<?ColorDefinition>}
 */
ColorDefinitionManager.prototype.resolve = function (desc, opts) {
  var self = this
  return Promise.try(function () {
    if (desc === self._uncolored.getDesc()) {
      return new UncoloredColorDefinition()
    }

    // check desc
    return self._record2ColorDefinition({id: -1, desc: desc})
      .then(function (cdef) {
        if (cdef === null) {
          throw new errors.ColorDefinition.IncorrectDesc(desc)
        }

        // add event new
        return self._storage.resolve(desc, opts)
          .then(function (data) {
            if (data.record === null) {
              return null
            }

            var promise = self._record2ColorDefinition(data.record)
            if (data.new === true) {
              promise.done(function (cdef) {
                timers.setImmediate(function () {
                  self.emit('new', cdef)
                })
              }, _.noop)
            }

            return promise
          })
      })
  })
}

/**
 * @param {Object} [opts]
 * @param {number} [opts.id]
 * @return {Promise.<(?ColorDefinition|ColorDefinition[])>}
 */
ColorDefinitionManager.prototype.get = function (opts) {
  var self = this
  var id = Object(opts).id
  if (id === undefined) {
    return self._storage.get()
      .then(function (records) {
        return Promise.map(records, function (record) {
          return self._record2ColorDefinition(record)
        })
      })
  }

  if (id === self._uncolored.getColorId()) {
    return Promise.resolve(new UncoloredColorDefinition())
  }

  return self._storage.get({id: id})
    .then(function (record) {
      if (record !== null) {
        return self._record2ColorDefinition(record)
      }

      return null
    })
}

module.exports = ColorDefinitionManager