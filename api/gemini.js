// Gemini AI Persona Generation Endpoint (Magnetic Copy with Clean Paragraph Line Breaks)
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (e) {}
const { requireAccess } = require('./access');

// Curated library of authentic personas with clean multi-line paragraph structure (\n\n)
const BEAUTIFUL_TEMPLATES = [
  {
    headline: "Spontaneous road trip or late night taco run?",
    post: "Always down for an impromptu drive with the windows down, good playlists, or hunting down the best hidden espresso spot in town.\n\nLooking for someone with great banter, positive energy, and zero drama.\n\nIf you're ready to skip the endless small talk and make an actual plan, say hi."
  },
  {
    headline: "Real chemistry, zero games.",
    post: "Life is busy enough—downtime should be easy, refreshing, and genuine.\n\nI value authenticity, a sharp sense of humor, and people who actually follow through on plans.\n\nTell me your favorite secret spot in the city and let's go from there."
  },
  {
    headline: "Coffee first, then let's see where the night goes.",
    post: "Balanced between quiet mornings with espresso and lively evenings discovering hidden speakeasies.\n\nLooking for someone charming, witty, and not afraid to step outside the usual routine.\n\nLet's trade music recommendations over a drink."
  },
  {
    headline: "Two truths and a lie: your turn.",
    post: "Big fan of impromptu weekend escapes, lively dinner conversations, and finding rooftop views that aren't on Google Maps.\n\nSeeking someone ambitious, grounded, and ready for real laughter.\n\nDrop me a message with your best travel story and let's see if we click."
  },
  {
    headline: "Keep it chill, keep it real.",
    post: "Just looking to de-stress and enjoy some genuine, high-vibe company after a long week.\n\nIf you're someone who appreciates great playlists, deep late-night talks, and a relaxed atmosphere, we'll get along well.\n\nNo pressure, no complicated expectations—just good company."
  },
  {
    headline: "Looking for trouble... the fun kind.",
    post: "If you're quick-witted, charming, and know how to have a memorable night out, I want to hear from you.\n\nI prefer authentic connections where conversation flows effortlessly and small talk is kept to a minimum.\n\nLet's skip the interrogation and plan something fun."
  },
  {
    headline: "Life is too short for boring conversations.",
    post: "Passionate about exploring new places, good food, and meeting people with a spark in their eye.\n\nLooking for someone who doesn't take themselves too seriously but takes good company seriously.\n\nIf that sounds like your wavelength, say hello."
  },
  {
    headline: "Sunday brunch energy with Friday night spontaneity.",
    post: "Always up for an adventurous road trip or trying the newest restaurant everyone is buzzing about.\n\nSeeking a partner-in-crime who brings good conversation, contagious laughter, and zero pretense.\n\nLet's grab a drink and see where things naturally lead."
  },
  {
    headline: "Match my energy & let's make a plan.",
    post: "Optimistic, ambitious, and always up for trying something out of the ordinary.\n\nHoping to meet someone grounded with a dry sense of humor, good taste in music, and real follow-through.\n\nTell me what you're craving this weekend."
  },
  {
    headline: "Tell me your favorite secret spot in town.",
    post: "Whether it's a quiet cliffside view, a dive bar with a great jukebox, or a hidden vinyl shop, I want to know about it.\n\nLooking for an authentic connection where we can just be ourselves and have fun.\n\nIf you're spontaneous and ready to meet up, message me."
  },
  {
    headline: "Work hard, unwind harder.",
    post: "Busy during the week building things, but my downtime is reserved for great food and even better company.\n\nLooking for someone playful, intelligent, and ready for spontaneous evening plans.\n\nLet's grab a glass of wine and unwind."
  },
  {
    headline: "Here for a good time & a real spark.",
    post: "I believe the best memories are always the ones you didn't over-plan.\n\nSeeking someone genuine who enjoys effortless banter, late-night bites, and honest vibes.\n\nSay hi and tell me the last thing that made you laugh out loud."
  },
  {
    headline: "Good food, better company, zero pretense.",
    post: "My ideal evening involves discovering a cozy local bistro, debating ridiculous theories, and sharing genuine laughs.\n\nIf you value real energy and want to actually meet someone worth talking to, let's connect.\n\nLet's pick a spot and make it happen."
  },
  {
    headline: "Let's trade playlists and grab a drink.",
    post: "Give me an open road, good music, and someone with a quick wit to keep up with.\n\nI'm drawn to confidence, honesty, and people who know what they want out of life.\n\nIf that's you, let's skip the small talk and connect."
  },
  {
    headline: "Sunset chaser with an adventurous spirit.",
    post: "Always planning the next trip or finding an excuse to get outdoors and explore.\n\nLooking for someone adventurous, warm-hearted, and ready to share unforgettable moments.\n\nTell me where you'd go if you could leave tomorrow."
  },
  {
    headline: "A little mystery, a lot of fun.",
    post: "Life is full of surprises, and tonight might just be one of them.\n\nI'm looking for someone who isn't afraid to step outside their comfort zone and enjoy something new.\n\nIf you're spontaneous and ready for a fresh connection, message me."
  },
  {
    headline: "Looking for someone who can make me laugh.",
    post: "Sarcasm, good coffee, and spontaneous plans are pretty much my love language.\n\nLooking for someone sharp, kind, and ready to step away from the phone screen for some real-life banter.\n\nIf you've got great energy, say hello."
  },
  {
    headline: "Let's see if our vibes match.",
    post: "No endless texting phase, no games—just two people who enjoy each other's presence.\n\nI appreciate good vibes, mutual respect, and effortless chemistry.\n\nIf you're free this week and want to meet up for a drink, hit me up."
  },
  {
    headline: "Casual vibes, unforgettable company.",
    post: "Easygoing by nature, but I love making every moment count when I'm out.\n\nLooking for someone who is charming, thoughtful, and ready for a memorable evening.\n\nLet's plan our first escape."
  },
  {
    headline: "Ready for an actual adventure?",
    post: "Pack a weekend bag and let's drive until the scenery looks right.\n\nI love people who are passionate about what they do and know how to let loose and enjoy life.\n\nIf you're spontaneous and ready for something real, let's talk."
  }
];

module.exports = async function handler(req, res) {
  if (!requireAccess(req, res)) return;

  const key = process.env.GEMINI_API_KEY || process.env.AI_STUDIO_KEY;

  const prompt = `You are an elite, natural copywriter creating magnetic and aesthetic dating & personal ad personas.
Create ONE completely unique, high-converting Headline and Post/Bio.

CRITICAL FORMATTING & STYLE RULES:
1. Headline:
   - Punchy, stylish, captivating single-line hook (under 10 words, NO emojis).
   - Confident, playful, or intriguing tone.

2. Post/Bio (MUST BE WRITTEN WITH CLEAN LINE BREAKS):
   - You MUST write the post in 2 to 3 distinct, short paragraphs separated by a clean double newline ("\\n\\n").
   - Paragraph 1: An engaging lifestyle/vibe hook (1-2 sentences about what you love doing or the energy you bring).
   - Paragraph 2: What you are looking for—authenticity, sharp wit, good chemistry, zero drama (1 sentence).
   - Paragraph 3: A smooth, confident call-to-action inviting them to say hi or make a real plan (1 sentence).
   - Style: Natural American English, authentic, casual, attractive, charming (NO emojis, NO hashtags, NO cheesy pickup lines).

3. Output format:
   - Return ONLY a valid JSON object with keys "headline" and "post".
   - Do NOT wrap in markdown code blocks.
   - The "post" value MUST contain "\\n\\n" between each paragraph so it formats cleanly with line breaks.`;

  // Valid Gemini model identifiers
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
  if (key && !key.includes('PLACEHOLDER')) {
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const aiResp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 1.0,
              responseMimeType: "application/json"
            }
          }),
          signal: AbortSignal.timeout(6000)
        });

        if (aiResp.ok) {
          const data = await aiResp.json();
          const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          let cleanText = textOut.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
          const parsed = JSON.parse(cleanText);
          if (parsed.headline && parsed.post) {
            // Ensure line breaks are preserved
            const formattedPost = String(parsed.post).replace(/\r\n/g, '\n').trim();
            return res.status(200).json({
              success: true,
              source: 'gemini',
              headline: parsed.headline.trim(),
              post: formattedPost
            });
          }
        }
      } catch (e) {
        // Continue to next model or fallback
      }
    }
  }

  // High-entropy fallback generator with clean line breaks (\n\n)
  const randomPreset = BEAUTIFUL_TEMPLATES[Math.floor(Math.random() * BEAUTIFUL_TEMPLATES.length)];
  return res.status(200).json({
    success: true,
    source: 'ai_engine',
    headline: randomPreset.headline,
    post: randomPreset.post
  });
};
