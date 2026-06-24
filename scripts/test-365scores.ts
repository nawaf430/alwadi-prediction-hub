import {
  build365MatchMap,
  fetch365ScoresGames,
  lookup365Match,
} from '../lib/365scores-api'

async function main() {
  const start = new Date(Date.now() - 4 * 60 * 60 * 1000)
  const end = new Date(Date.now() + 2 * 60 * 60 * 1000)
  const games = await fetch365ScoresGames(start, end)
  console.log('games fetched:', games?.length ?? 'null')
  if (!games) return

  const map = build365MatchMap(games)
  console.log('map size:', map.size)

  const pairs = [
    ['المكسيك', 'جنوب أفريقيا'],
    ['هولندا', 'السويد'],
    ['البرازيل', 'هايتي'],
  ] as const

  for (const [home, away] of pairs) {
    console.log(`${home} vs ${away}:`, lookup365Match(map, home, away) ?? 'not found')
  }
}

main().catch(console.error)
