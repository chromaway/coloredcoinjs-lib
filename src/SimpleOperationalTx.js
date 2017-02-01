var inherits = require('util').inherits

var _ = require('lodash')

var OperationalTx = require('./OperationalTx')
var ColorValue = require('./ColorValue')
var ColorDefinitionManager = require('./ColorDefinitionManager')
var errors = require('./errors')
var verify = require('./verify')


/**
 * @class SimpleOperationalTx
 * @extends OperationalTx
 * @param {Object} data
 * @param {ColorTarget[]} data.targets
 * @param {OperationalTx~AbstractRawCoin[]} data.coins
 * @param {Object} data.changeAddresses
 * @param {string} data.changeAddresses.colorId1
 * @param {string} data.changeAddresses.colorIdN
 * @param {number} data.fee
 */
function SimpleOperationalTx(data) {
  verify.object(data)
  verify.array(data.targets)
  data.targets.forEach(verify.ColorTarget)
  verify.array(data.coins)
  data.coins.forEach(function (coin) {
    verify.object(coin)
    verify.number(coin.colorId)
    verify.txId(coin.txId)
    verify.number(coin.outIndex)
    verify.number(coin.value)
  })
  verify.object(data.changeAddresses)
  _.forEach(data.changeAddresses, function (colorId, address) {
    verify.number(parseInt(colorId, 10))
    verify.string(address)
  })
  verify.number(data.fee)

  OperationalTx.call(this)

  this._data = data
}

inherits(SimpleOperationalTx, OperationalTx)

/**
 * @{link OperationalTx~getTargets}
 */
SimpleOperationalTx.prototype.getTargets = function () {
  return this._data.targets
}

/**
 * @{link OperationalTx~selectCoins}
 */
SimpleOperationalTx.prototype.selectCoins = function (colorValue, feeEstimator, cb) {
  if (_.isUndefined(cb)) {
    cb = feeEstimator
    feeEstimator = null
  }
  verify.ColorValue(colorValue)
  if (_.isUndefined(feeEstimator)) { feeEstimator = null }
  if (feeEstimator !== null) {
    verify.object(feeEstimator)
    verify.function(feeEstimator.estimateRequiredFee)
    if (!colorValue.isUncolored()) {
      throw new errors.VerifyTypeError('feeEstimator can only be used with uncolored coins')
    }
  }
  verify.function(cb)

  var coins = []
  var totalValue = 0
  this._data.coins.some(function (coin) {
    if (coin.colorId !== colorValue.getColorId()) {
      return false
    }

    coins.push({toRawCoin: function () { return coin }})
    totalValue += coin.value

    var neededValue = colorValue.getValue()
    if (feeEstimator !== null) {
      neededValue += feeEstimator.estimateRequiredFee({txIns: coins.length}).getValue()
    }

    return totalValue >= neededValue
  })

  var totalColorValue = new ColorValue(colorValue.getColorDefinition(), totalValue)

  cb(null, coins, totalColorValue)
}

/**
 * @{linkcode OperationalTx~getChangeAddress}
 */
SimpleOperationalTx.prototype.getChangeAddress = function (colordef) {
  verify.ColorDefinition(colordef)
  return this._data.changeAddresses[colordef.getColorId()]
}

/**
 * @{link OperationalTx~getRequiredFee}
 */
SimpleOperationalTx.prototype.getRequiredFee = function () {
  return new ColorValue(new ColorDefinitionManager.getUncolored(), this._data.fee)
}

/**
 * @{link OperationalTx~getDustThreshold}
 */
SimpleOperationalTx.prototype.getDustThreshold = function () {
  return new ColorValue(new ColorDefinitionManager.getUncolored(), 5500)
}


module.exports = SimpleOperationalTx
