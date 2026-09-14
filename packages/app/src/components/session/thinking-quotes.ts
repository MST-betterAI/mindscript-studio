// mindscript_change: something to read while the engine works. Deliberately a fixed local list
// rather than a model call: these are famous quotations, a closed set that never needs
// generating, and asking a model for one would spend tokens and add latency on every turn to
// produce text nobody is waiting on. Local means instant, free, and it still works offline.
export interface Quote {
  readonly text: string
  readonly who: string
}

export const THINKING_QUOTES: readonly Quote[] = [
  { text: "The important thing is not to stop questioning.", who: "Albert Einstein" },
  { text: "Simplicity is the ultimate sophistication.", who: "Leonardo da Vinci" },
  { text: "Everything should be made as simple as possible, but not simpler.", who: "Albert Einstein" },
  { text: "Premature optimization is the root of all evil.", who: "Donald Knuth" },
  { text: "Programs must be written for people to read.", who: "Harold Abelson" },
  { text: "There are only two hard things in computer science: cache invalidation and naming things.", who: "Phil Karlton" },
  { text: "Perfection is achieved when there is nothing left to take away.", who: "Antoine de Saint-Exupéry" },
  { text: "Any sufficiently advanced technology is indistinguishable from magic.", who: "Arthur C. Clarke" },
  { text: "The best way to predict the future is to invent it.", who: "Alan Kay" },
  { text: "Talk is cheap. Show me the code.", who: "Linus Torvalds" },
  { text: "Science is what we understand well enough to explain to a computer.", who: "Donald Knuth" },
  { text: "If you can't explain it simply, you don't understand it well enough.", who: "Albert Einstein" },
  { text: "The first principle is that you must not fool yourself — and you are the easiest person to fool.", who: "Richard Feynman" },
  { text: "What I cannot create, I do not understand.", who: "Richard Feynman" },
  { text: "Measure what is measurable, and make measurable what is not so.", who: "Galileo Galilei" },
  { text: "In theory there is no difference between theory and practice. In practice there is.", who: "Yogi Berra" },
  { text: "Testing shows the presence, not the absence of bugs.", who: "Edsger W. Dijkstra" },
  { text: "Make it work, make it right, make it fast.", who: "Kent Beck" },
  { text: "A distributed system is one where a machine you've never heard of can break yours.", who: "Leslie Lamport" },
  { text: "Errors using inadequate data are much less than those using no data at all.", who: "Charles Babbage" },
  { text: "Nothing in life is to be feared, it is only to be understood.", who: "Marie Curie" },
  { text: "Somewhere, something incredible is waiting to be known.", who: "Carl Sagan" },
  { text: "Extraordinary claims require extraordinary evidence.", who: "Carl Sagan" },
  { text: "If I have seen further it is by standing on the shoulders of giants.", who: "Isaac Newton" },
  { text: "An investment in knowledge pays the best interest.", who: "Benjamin Franklin" },
  { text: "It always seems impossible until it's done.", who: "Nelson Mandela" },
  { text: "The only way to do great work is to love what you do.", who: "Steve Jobs" },
  { text: "Fall seven times, stand up eight.", who: "Japanese proverb" },
  { text: "Well begun is half done.", who: "Aristotle" },
  { text: "We are what we repeatedly do. Excellence, then, is a habit.", who: "Will Durant" },
  { text: "The map is not the territory.", who: "Alfred Korzybski" },
  { text: "All models are wrong, but some are useful.", who: "George Box" },
  { text: "Given enough eyeballs, all bugs are shallow.", who: "Linus's Law" },
  { text: "Weeks of coding can save you hours of planning.", who: "Anonymous" },
  { text: "First, solve the problem. Then, write the code.", who: "John Johnson" },
  { text: "The question of whether machines can think is about as relevant as whether submarines can swim.", who: "Edsger W. Dijkstra" },
]

/**
 * A quote chosen from the session id, so one turn keeps one quote instead of flickering between
 * them on every re-render, and two sessions working at once do not show the same line.
 */
export function quoteFor(seed: string, index = 0): Quote {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const at = Math.abs(hash + index * 7919) % THINKING_QUOTES.length
  return THINKING_QUOTES[at]!
}
