const { EventEmitter } = require('events')
const debug = require('debug')('WikiBattle:game')
const newless = require('newless')
const ms = require('ms')
const generateId = require('crypto-random-string')
const wiki = require('./wiki')

const HINT_TIMEOUT = ms('40 seconds')
const BACKLINKS_TIMEOUT = ms('90 seconds')

/**
 * Represents a 1v1 WikiBattle match.
 */

module.exports = newless(class WikiBattle extends EventEmitter {
  constructor (origin, goal) {
    super()
    this.id = generateId(7)
    this.players = []
    this.origin = origin
    this.goal = goal
  }

  /**
   * Send a message to all players.
   */

  emitSocket (...args) {
    return this.players.forEach((player) => {
      const sock = player.sock
      if (sock) {
        sock.emit(...args)
      }
    })
  }

  /**
   * Add a new player to the game.
   */

  connect (connectingPlayer) {
    debug('connect player', connectingPlayer.id)
    this.players.forEach((player) => {
      player.notifyConnect(connectingPlayer)
      connectingPlayer.notifyConnect(player)
    })
    this.players.push(connectingPlayer)
    return this
  }

  /**
   * Remove a player from the game.
   */

  disconnect (disconnectingPlayer) {
    debug('disconnect player', disconnectingPlayer.id)
    disconnectingPlayer.disconnect()
    this.navigate(disconnectingPlayer, null)

    var connected = this.players.filter((p) => p.connected)
    connected.forEach((p) => {
      p.notifyDisconnect(disconnectingPlayer)
    })
    if (connected.length === 1) {
      connected[0].win()
      this.end()
    }
  }

  /**
   * Check if any player has reached the target article.
   */

  checkWin () {
    const hasWon = (p) => p.current() === this.goal
    if (this.players.some(hasWon)) {
      this.players.forEach((p) => {
        hasWon(p) ? p.win() : p.lose()
      })
      this.end()
    }
  }

  /**
   * Navigate a player to the next article.
   *
   * @api private
   */

  navigateInner (player, to) {
    player.navigateTo(to)
    this.emitSocket('navigated', player.id, to)
    this.checkWin()
  }

  /**
   * Attempt to navigate to an article.
   */

  navigate (player, to) {
    debug('navigate (maybe)', player.id, `${player.current()} -> ${to}`)
    if (to === null || !player.current()) {
      return this.navigateInner(player, to)
    }
    // Check that the current article links to the next.
    wiki.get(player.current(), (e, page) => {
      if (!e && page.linksTo(to)) {
        this.navigateInner(player, to)
      } else {
        // Maybe put some fancy "Do not cheat" page here?
      }
    })
  }

  /**
   * Send a hint for the target article to the players.
   */

  sendHint () {
    wiki.get(this.goal, (e, page) => {
      this.emitSocket('hint', e || page.getHint())
    })
  }

  /**
   * Send a list of articles that link to the target article to the players.
   */

  sendBacklinks () {
    wiki.get(this.goal, (e, page) => {
      if (e) return this.emitSocket('backlinks', e)
      page.getBacklinks((e, back) => {
        this.emitSocket('backlinks', e, back)
      })
    })
  }

  /**
   * Send the final paths taken by each player to the players.
   */

  sendPaths () {
    const paths = this.players.reduce((paths, p) => {
      paths[p.id] = p.path
      return paths
    }, {})
    this.emitSocket('paths', paths)
  }

  /**
   * Start the game.
   */

  start () {
    this.emitSocket('start', this.origin, this.goal)

    this.players.forEach((p) => {
      this.navigate(p, this.origin)
    })

    this.hintTimeout = setTimeout(this.sendHint.bind(this), HINT_TIMEOUT)
    this.backlinksTimeout = setTimeout(this.sendBacklinks.bind(this), BACKLINKS_TIMEOUT)
  }

  /**
   * End the game.
   */

  end () {
    this.sendPaths()
    clearTimeout(this.hintTimeout)
    clearTimeout(this.backlinksTimeout)
  }

  /**
   * Notify all other players that a player's scroll position has changed.
   */

  notifyScroll (scroller, top, width) {
    this.players.forEach((player) => {
      if (scroller !== player) {
        player.notifyScroll(scroller, top, width)
      }
    })
  }
})
