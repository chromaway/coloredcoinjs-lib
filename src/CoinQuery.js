var assert = require('assert')

var _ = require('lodash')

var blockchain = require('./blockchain')
var Coin = require('./Coin')
var CoinList = require('./CoinList')
var ColorData = require('./ColorData')
var colordef = require('./colordef')
var ColorDefinitionManager = require('./ColorDefinitionManager')


/**
 * @class CoinQuery
 *
 * @param {Object} params
 * @param {Array} params.addresses
 * @param {BlockchainStateBase} params.blockchain
 * @param {ColorData} params.colorData
 * @param {ColorDefinitionManager} params.colorDefinitionManager
 */
function CoinQuery(params) {
  assert(_.isObject(params), 'Expected Object params, got ' + params)
  assert(_.isArray(params.addresses), 'Expected Array params.addresses, got ' + params.addresses)
  params.addresses.forEach(function(address) {
    // Check address instead string
    assert(_.isString(address), 'Expected Array of string params.addresses, got ' + params.addresses)
  })
  assert(params.blockchain instanceof blockchain.BlockchainStateBase,
    'Expected params.blockchain instanceof BlockchainStateBase, got ' + params.blockchain)
  assert(params.colorData instanceof ColorData,
    'Expected params.colorData instanceof ColorData, got ' + params.colorData)
  assert(params.colorDefinitionManager instanceof ColorDefinitionManager,
    'Expected params.colorDefinitionManager instanceof ColorDefinitionManager, got ' + params.colorDefinitionManager)

  this.addresses = params.addresses
  this.blockchain = params.blockchain
  this.colorData = params.colorData
  this.colorDefinitionManager = params.colorDefinitionManager

  this.query = {
    onlyColoredAs: null,
    onlyConfirmed: false,
    onlyUnconfirmed: false
  }
}

/**
 * Create clone current CoinQuery
 *
 * @return {CoinQuery}
 */
CoinQuery.prototype.clone = function() {
  var newCoinQuery = new CoinQuery({
    addresses: this.addresses,
    blockchain: this.blockchain,
    colorData: this.colorData,
    colorDefinitionManager: this.colorDefinitionManager
  })

  newCoinQuery.query = _.clone(this.query)

  return newCoinQuery
}

/**
 * Select coins only for given ColorDefinition
 *
 * @param {ColorDefinition} colorDefinition
 * @return {CoinQuery}
 */
CoinQuery.prototype.onlyColoredAs = function(colorDefinition) {
  assert(colorDefinition instanceof colordef.ColorDefinition,
    'Expected instanceof ColorDefinition colorDefinition, got ' + colorDefinition)

  var newCoinQuery = this.clone()
  newCoinQuery.query.onlyColoredAs = colorDefinition

  return newCoinQuery
}

/**
 * Select only confirmed coins
 *
 * @return {CoinQuery}
 */
CoinQuery.prototype.getConfirmed = function() {
  var newCoinQuery = this.clone()
  newCoinQuery.query.onlyConfirmed = true
  newCoinQuery.query.onlyUnconfirmed = false

  return newCoinQuery
}

/**
 * Select only unconfirmed coins
 *
 * @return {CoinQuery}
 */
CoinQuery.prototype.getUnconfirmed = function() {
  var newCoinQuery = this.clone()
  newCoinQuery.query.onlyConfirmed = false
  newCoinQuery.query.onlyUnconfirmed = true

  return newCoinQuery
}

/**
 * Select coins and return CoinList via cb
 *
 * @param {function} cb Called on finished with params (error, CoinList)
 */
CoinQuery.prototype.getCoins = function(cb) {
  assert(_.isFunction(cb), 'Expected function cb, got ' + cb)

  var _this = this

  var utxo = []
  function getUTXO(index) {
    if (_this.addresses.length === index) {
      filterUTXO(0)
      return
    }

    _this.blockchain.getUTXO(_this.addresses[index], function(error, result) {
      if (error !== null) {
        cb(error)
        return
      }

      utxo = utxo.concat(result)
      getUTXO(index+1)
    })
  }

  var coins = []
  function filterUTXO(index) {
    if (utxo.length === index) {
      cb(null, new CoinList(coins))
      return
    }

    var coin = new Coin({
      colorData: _this.colorData,
      colorDefinitionManager: _this.colorDefinitionManager,
      txId: utxo[index].txId,
      outIndex: utxo[index].outIndex,
      value: utxo[index].value,
      confirmations: utxo[index].confirmations
    })

    if ((_this.query.onlyConfirmed && !coin.isConfirmed()) || (_this.query.onlyUnconfirmed && coin.isConfirmed())) {
      process.nextTick(function() { filterUTXO(index+1) })
      return
    }

    if (_this.query.onlyColoredAs !== null) {
      coin.getMainColorValue(function(error, colorValue) {
        if (error !== null) {
          cb(error)
          return
        }

        if (_this.query.onlyColoredAs.getColorId() === colorValue.getColorId())
          coins.push(coin)

        filterUTXO(index+1)
      })

    } else {
      coins.push(coin)
      process.nextTick(function() { filterUTXO(index+1) })
    }
  }

  getUTXO(0)
}

//Todo
//CoinQuery.prototype.getHistory = function() {}


module.exports = CoinQuery
