/**
 * validateMeaningfulText
 *
 * Checks that a string reads like natural human language rather than
 * random keyboard-mashing (e.g. "jdbrivxkduf", "asdfghjkl", "zzzzz").
 *
 * Strategy — a token passes if ANY of these are true:
 *   1. It is a known common word (from a 500+ word English + common
 *      Indian-English vocabulary list).
 *   2. It is a number, date fragment, or common abbreviation.
 *   3. It has a plausible consonant-vowel pattern (vowel ratio 20–75 %,
 *      no run of 4+ consonants that doesn't appear in the known list,
 *      no run of the same letter 3+ times).
 *
 * The full text passes if at least 60 % of its tokens (words) pass.
 * Single-word inputs need the word itself to pass.
 *
 * Returns: null if valid, or a string error message if invalid.
 */

// ── Vocabulary ────────────────────────────────────────────────────────────────
// Common English words + Indian-English academic / HR / leave context words.
// Lowercase only.
const KNOWN_WORDS = new Set([
  // Articles / prepositions / conjunctions
  "a","an","the","in","on","at","by","for","of","to","and","or","but","nor",
  "so","yet","with","from","into","onto","upon","over","under","about","above",
  "after","before","between","through","during","along","against","without",
  "within","around","among","beside","beyond","behind","below","near","off",
  "out","up","down","as","than","if","though","although","because","since",
  "while","when","where","how","that","this","these","those","which","who",
  "whom","whose","what","not","no","nor","both","either","neither","each",
  "every","all","any","few","more","most","other","some","such",
  // Pronouns
  "i","me","my","mine","myself","we","us","our","ours","ourselves",
  "you","your","yours","yourself","yourselves","he","him","his","himself",
  "she","her","hers","herself","it","its","itself","they","them","their",
  "theirs","themselves",
  // Common verbs
  "am","is","are","was","were","be","been","being","have","has","had","do",
  "does","did","will","would","shall","should","may","might","must","can",
  "could","need","dare","ought","used","get","got","make","made","take",
  "took","come","came","go","went","see","saw","know","knew","think","thought",
  "feel","felt","want","wanted","use","used","try","tried","call","called",
  "keep","kept","let","put","seem","seemed","leave","left","turn","turned",
  "ask","asked","work","worked","move","moved","live","lived","give","gave",
  "tell","told","hold","held","bring","brought","begin","began","show","showed",
  "hear","heard","play","played","run","ran","stand","stood","lose","lost",
  "pay","paid","meet","met","include","apply","applied","appear","attend",
  "request","requested","inform","informed","submit","submitted","provide",
  "need","required","granted","approved","rejected","noted","kindly","please",
  // Adjectives / adverbs
  "good","better","best","bad","worse","worst","new","old","first","last",
  "long","great","little","own","right","high","small","large","next","early",
  "young","important","public","private","real","only","same","able","due",
  "far","few","full","just","late","medical","personal","official","urgent",
  "serious","severe","sudden","immediate","unavoidable","unforeseen","prior",
  "sudden","scheduled","unscheduled","annual","monthly","weekly","daily",
  // Leave / HR vocabulary
  "leave","leaves","casual","sick","medical","maternity","paternity","earned",
  "privilege","bereavement","duty","compensatory","emergency","half","day","days",
  "week","weeks","month","months","year","years","date","dates","period","time",
  "reason","reasons","purpose","purposes","request","requests","approval","note",
  "absence","absent","attend","attendance","return","resume","rejoin","joining",
  "family","health","illness","fever","cold","flu","injury","accident","surgery",
  "hospital","hospitalization","treatment","recovery","checkup","appointment",
  "doctor","physician","specialist","medicine","medication","prescription","rest",
  "bed","bedridden","admitted","discharge","operation","procedure","therapy",
  "funeral","cremation","death","demise","passing","relative","parent","father",
  "mother","sister","brother","son","daughter","spouse","wife","husband","child",
  "children","grandparent","grandfather","grandmother","uncle","aunt","cousin",
  "function","ceremony","wedding","marriage","ritual","prayer","puja","pooja",
  "festival","celebration","event","occasion","religious","personal","domestic",
  "emergency","urgent","unforeseen","unavoidable","sudden","immediate","prior",
  "travel","travelling","traveling","trip","journey","hometown","native","place",
  "village","city","town","district","state","station","outstation","onsite",
  "visit","visiting","home","office","college","school","university","campus",
  "exam","examination","test","interview","conference","seminar","workshop",
  "training","development","course","program","programme","duty","official",
  "government","department","ministry","authority","committee","board","council",
  // Academic subjects context
  "class","classes","lecture","lectures","lab","laboratory","practical","subject",
  "assignment","project","research","thesis","dissertation","paper","report",
  "presentation","session","semester","term","academic","syllabus","curriculum",
  // Common Indian names / places (just a few to avoid false positives)
  "delhi","mumbai","pune","chennai","bengaluru","bangalore","hyderabad","kolkata",
  "india","maharashtra","gujarat","rajasthan","karnataka","kerala",
  // College course names & abbreviations (won't be flagged as gibberish)
  "bsc","bca","bcom","baf","bbi","bfm","bammc","bms","btech","msc","mca",
  "it","ds","ai","ml","cs","df","vfx","fy","sy","ty","fybsc","sybsc","tybsc",
  "fybcom","sybcom","tybcom","fybca","sybca","tybca",
  "data","science","technology","information","cyber","security","forensics",
  "animation","visual","effects","multimedia","communication","management",
  "commerce","finance","accounting","banking","insurance","markets",
  "artificial","intelligence","machine","learning","deep","neural",
  "network","networks","computer","applications","digital",
  "eleven","twelve","thirteen","fourteen","fifteen","twenty","thirty",
  "forty","fifty","hundred","thousand",
  // Misc
  "etc","approximately","regarding","reference","hereby","herewith","enclosed",
  "attached","mentioned","above","below","sincerely","respectfully","thanking",
  "kindly","humbly","request","requested","granted","noted","acknowledged",
  "confirmed","verified","checked","approved","rejected","pending","forwarded",
  "available","unavailable","possible","impossible","necessary","unnecessary",
  "following","enclosed","attached","concerned","responsible","required",
  "informed","intimated","communicated","mentioned","specified","stated",
]);

// Known 4+ consecutive consonant clusters that appear in real English words
const KNOWN_CLUSTERS = new Set([
  "str","spr","scr","thr","shr","sch","chr","phr","whr",
  "nths","ngth","rkng","rths","lths","sts","nds","rds","lts","nts",
  "rst","nst","rks","lps","mps","ngs","rns","lls","rms","rds",
  "ght","dth","fth","xth","lth","nth","rth","mth",
]);

const VOWELS = new Set(["a","e","i","o","u"]);

function isConsonant(ch: string) {
  return /[a-z]/.test(ch) && !VOWELS.has(ch);
}

/** Returns true if the token looks like a plausible word (not gibberish). */
function tokenIsPlausible(raw: string): boolean {
  const t = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!t) return true; // punctuation-only token, skip

  // Numbers, dates, abbreviations (2-3 uppercase chars = OK)
  if (/^\d+$/.test(t)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(raw)) return true;
  if (/^[a-z]{1,3}\.?$/.test(t)) return true; // short abbrev like "dr", "mr", "st", "no"

  // Known word
  if (KNOWN_WORDS.has(t)) return true;

  // Length sanity
  if (t.length > 20) return false;

  // Vowel ratio check (real words are 20–78 % vowels)
  const vowelCount = [...t].filter((c) => VOWELS.has(c)).length;
  const ratio = vowelCount / t.length;
  if (ratio < 0.18 || ratio > 0.78) return false;

  // Repeated character run of 2+ same letters (e.g. "aaa", "bbb", "ssss") — gibberish
  if (/(.)\1\1/.test(t)) return false; // 3+ same in a row
  // Pure keyboard-row patterns (qwerty / asdf runs of 5+)
  if (/[qwert]{5,}|[asdfg]{5,}|[zxcvb]{5,}|[yuiop]{5,}|[hjkl]{4,}/i.test(t)) return false;

  // Consecutive consonant run > 3 — check against known clusters
  const consonantRuns = t.match(/[^aeiou]{4,}/g) ?? [];
  for (const run of consonantRuns) {
    const ok = KNOWN_CLUSTERS.has(run) ||
               [...KNOWN_CLUSTERS].some((k) => run.includes(k));
    if (!ok) return false;
  }

  return true;
}

export interface TextValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that `text` contains meaningful natural language.
 *
 * @param text      The input string to validate.
 * @param fieldName Label used in the error message (e.g. "Reason", "Note").
 * @param required  If true, empty string returns an error. Default false.
 */
export function validateMeaningfulText(
  text: string,
  fieldName = "Text",
  required = false,
): TextValidationResult {
  const trimmed = text.trim();

  if (!trimmed) {
    if (required) return { valid: false, error: `${fieldName} is required.` };
    return { valid: true };
  }

  // Too short to evaluate properly — allow anything 1-2 chars (could be "OK", "NA")
  if (trimmed.length < 3) return { valid: true };

  // Split into tokens by whitespace
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);

  if (tokens.length === 0) return { valid: true };

  // Count how many tokens pass the plausibility check
  const passing = tokens.filter(tokenIsPlausible).length;
  const ratio = passing / tokens.length;

  // Single-token input: the token itself must pass
  if (tokens.length === 1) {
    if (!tokenIsPlausible(tokens[0])) {
      return {
        valid: false,
        error: `${fieldName} appears to contain random characters. Please write a meaningful ${fieldName.toLowerCase()}.`,
      };
    }
    return { valid: true };
  }

  // Multi-token: require at least 70 % of words to be plausible
  if (ratio < 0.7) {
    return {
      valid: false,
      error: `${fieldName} contains unrecognizable words. Please write a clear, meaningful ${fieldName.toLowerCase()}.`,
    };
  }

  return { valid: true };
}

/**
 * Live feedback for a text field — returns a warning string while the user
 * is typing (after 6+ chars), or null if the text looks fine.
 * Designed for use in onChange handlers to show inline hints.
 */
export function liveTextHint(text: string): string | null {
  if (text.trim().length < 6) return null;
  const result = validateMeaningfulText(text, "Text");
  if (!result.valid) return "⚠ Please use proper words.";
  return null;
}