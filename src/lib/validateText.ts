/**
 * validateMeaningfulText
 *
 * Checks that a string reads like natural human language rather than
 * random keyboard-mashing (e.g. "jdbrivxkduf", "asdfghjkl", "zzzzz").
 *
 * Strategy — a token passes if ANY of these are true:
 *   1. It is a known common word (500+ word English + Indian-English vocab).
 *   2. It is a number, date fragment, or short abbreviation (≤ 3 chars).
 *   3. It has a plausible consonant-vowel pattern:
 *        - vowel ratio 20–75 %
 *        - no run of 3+ same character
 *        - no keyboard-row pattern of 4+ chars
 *        - no run of 4+ consonants that isn't a known English cluster
 *
 * The full text passes if at least 70 % of its tokens pass.
 */

// ── Vocabulary ────────────────────────────────────────────────────────────────
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
  "feel","felt","want","wanted","use","try","tried","call","called",
  "keep","kept","let","put","seem","seemed","leave","left","turn","turned",
  "ask","asked","work","worked","move","moved","live","lived","give","gave",
  "tell","told","hold","held","bring","brought","begin","began","show","showed",
  "hear","heard","play","played","run","ran","stand","stood","lose","lost",
  "pay","paid","meet","met","include","apply","applied","appear","attend",
  "request","requested","inform","informed","submit","submitted","provide",
  "required","granted","approved","rejected","noted","kindly","please",
  // Adjectives / adverbs
  "good","better","best","bad","worse","worst","new","old","first","last",
  "long","great","little","own","right","high","small","large","next","early",
  "young","important","public","private","real","only","same","able","due",
  "far","full","just","late","medical","personal","official","urgent",
  "serious","severe","sudden","immediate","unavoidable","unforeseen","prior",
  "scheduled","unscheduled","annual","monthly","weekly","daily",
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
  "festival","celebration","event","occasion","religious","domestic",
  "travel","travelling","traveling","trip","journey","hometown","native","place",
  "village","city","town","district","state","station","outstation","onsite",
  "visit","visiting","home","office","college","school","university","campus",
  "exam","examination","test","interview","conference","seminar","workshop",
  "training","development","course","program","programme","official",
  "government","department","ministry","authority","committee","board","council",
  "class","classes","lecture","lectures","lab","laboratory","practical","subject",
  "assignment","project","research","thesis","dissertation","paper","report",
  "presentation","session","semester","term","academic","syllabus","curriculum",
  // Common Indian names / places
  "delhi","mumbai","pune","chennai","bengaluru","bangalore","hyderabad","kolkata",
  "india","maharashtra","gujarat","rajasthan","karnataka","kerala",
  // Course abbreviations
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
  // Misc / formal language
  "etc","approximately","regarding","reference","hereby","herewith","enclosed",
  "attached","mentioned","sincerely","respectfully","thanking",
  "humbly","acknowledged","confirmed","verified","checked","pending","forwarded",
  "available","unavailable","possible","impossible","necessary","unnecessary",
  "following","concerned","responsible","informed","intimated","communicated",
  "specified","stated",
]);

// Known consonant clusters that appear in real English words
const KNOWN_CLUSTERS = new Set([
  "str","spr","scr","thr","shr","sch","chr","phr",
  "nths","ngth","rkng","rths","lths","sts","nds","rds","lts","nts",
  "rst","nst","rks","lps","mps","ngs","rns","lls","rms",
  "ght","dth","fth","xth","lth","nth","rth","mth",
  "ck","sk","sp","st","sw","sc","sm","sn","sl",
  "bl","cl","fl","gl","pl","sl","br","cr","dr","fr","gr","pr","tr","wr",
]);

const VOWELS = new Set(["a","e","i","o","u"]);

function hasKnownCluster(run: string): boolean {
  if (KNOWN_CLUSTERS.has(run)) return true;
  for (const k of KNOWN_CLUSTERS) {
    if (run.includes(k)) return true;
  }
  return false;
}

/** Returns true if the token looks like a plausible word (not gibberish). */
function tokenIsPlausible(raw: string): boolean {
  const t = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!t) return true; // punctuation-only token — skip

  // Numbers and date fragments
  if (/^\d+$/.test(t)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(raw)) return true;

  // Short abbreviations (≤ 3 chars) — allow freely; only block via whole-word list
  if (/^[a-z]{1,3}\.?$/.test(t)) return true;

  // Known vocabulary word
  if (KNOWN_WORDS.has(t)) return true;

  // Length sanity
  if (t.length > 22) return false;

  // Must have at least one vowel
  const vowelCount = [...t].filter((c) => VOWELS.has(c)).length;
  if (vowelCount === 0) return false;

  // Vowel ratio 20–75 % (tightened upper bound to 75)
  const ratio = vowelCount / t.length;
  if (ratio < 0.20 || ratio > 0.75) return false;

  // 3+ same character in a row (e.g. "aaa", "zzz")
  if (/(.)(\1){2}/.test(t)) return false;

  // Keyboard-row runs of 4+ chars (tightened from 5)
  if (/[qwert]{4,}|[asdfg]{4,}|[zxcvb]{4,}|[yuiop]{4,}|[hjkl]{4,}/i.test(t)) return false;

  // Consecutive consonant run of 4+ — must match a known cluster
  const consonantRuns = t.match(/[^aeiou]{4,}/g) ?? [];
  for (const run of consonantRuns) {
    if (!hasKnownCluster(run)) return false;
  }

  return true;
}

export interface TextValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that `text` contains meaningful natural language.
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

  // Too short to meaningfully evaluate — only skip for 1–2 chars
  if (trimmed.length <= 2) return { valid: true };

  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { valid: true };

  const passing = tokens.filter(tokenIsPlausible).length;
  const ratio = passing / tokens.length;

  // Single-token: must itself pass
  if (tokens.length === 1) {
    if (!tokenIsPlausible(tokens[0])) {
      return {
        valid: false,
        error: `${fieldName} appears to contain random characters. Please write a meaningful ${fieldName.toLowerCase()}.`,
      };
    }
    return { valid: true };
  }

  // Multi-token: require 70 % of words to be plausible
  if (ratio < 0.70) {
    return {
      valid: false,
      error: `${fieldName} contains unrecognisable words. Please write a clear, meaningful ${fieldName.toLowerCase()}.`,
    };
  }

  return { valid: true };
}

export function liveTextHint(text: string): string | null {
  if (text.trim().length < 6) return null;
  const result = validateMeaningfulText(text, "Text");
  if (!result.valid) return "Please use proper words.";
  return null;
}
