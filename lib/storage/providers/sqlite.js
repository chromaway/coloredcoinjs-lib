var Promise = require('bluebird')
var readyMixin = require('ready-mixin')(Promise)
var makeConcurrent = require('make-concurrent')(Promise)
var sqlite3 = require('sqlite3')

/**
 * @class SQLiteProvider
 * @param {string} filename
 */
function SQLiteProvider (filename) {
  this._filename = filename
}

readyMixin(SQLiteProvider.prototype)

/**
 * @return {boolean}
 */
SQLiteProvider.isAvailable = function () { return true }

/**
 * @return {Promise}
 */
SQLiteProvider.prototype.open = function () {
  var self = this
  return new Promise(function (resolve, reject) {
    var db = new sqlite3.Database(self._filename, function (err) {
      if (err !== null) {
        return reject(err)
      }

      resolve()
    })

    self._db = Promise.promisifyAll(db)
  })
  .then(function () { self._ready() }, function (err) {
    self._ready(err)
    throw err
  })
}

/**
 * @callback SQLiteProvider~transactionCallback
 * @param {Object} tx
 * @param {function} tx.execute
 */

/**
 * @param {SQLiteProvider~transactionCallback} fn
 * @return {Promise}
 */
SQLiteProvider.prototype.transaction = makeConcurrent(function (fn) {
  var self = this
  return self.ready.then(function () {
    // create real transaction?
    function execute (sql, args) {
      return self._db.allAsync(sql, args)
        .then(function (rows) { return rows || [] })
    }

    return fn({execute: execute})
  })
})

module.exports = SQLiteProvider