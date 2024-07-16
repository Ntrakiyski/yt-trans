const puppeteer = require("puppeteer");
require("dotenv").config();


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


const scrapeLogic = async (res) => {
  const browser = await puppeteer.launch({
    args: [
      "--disable-setuid-sandbox",
      "--no-sandbox",
      "--single-process",
      "--no-zygote",
    ],
    executablePath:
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_EXECUTABLE_PATH
        : puppeteer.executablePath(),
  });
  try {
    const page = await browser.newPage();

    await page.goto(videoUrl, { waitUntil: 'domcontentloaded' });

    // Wait for 2 seconds after the page loads
    await sleep(2000);

    // Evaluate the contents of the h4 elements, time, and URL, and video title
    const { chapters, videoTitle } = await page.evaluate(() => {
      const chapterItems = [];
      const markerItems = document.querySelectorAll('ytd-macro-markers-list-item-renderer');
      const videoTitleElement = document.querySelector('#title h1.style-scope.ytd-watch-metadata .style-scope.ytd-watch-metadata');
      const videoTitle = videoTitleElement ? videoTitleElement.innerText.trim() : 'Unknown Title';

      markerItems.forEach(markerItem => {
        const h4 = markerItem.querySelector('#details h4');
        const timeDiv = markerItem.querySelector('#details #time');
        const endpoint = markerItem.querySelector('.style-scope.ytd-macro-markers-list-renderer #endpoint');
        if (h4 && timeDiv && endpoint) {
          const chapter = h4.textContent.trim();
          const time = timeDiv.textContent.trim();
          const url = endpoint.href.trim();
          chapterItems.push({ chapter, time, url });
        }
      });
      return { chapters: chapterItems, videoTitle };
    });

    // Navigate to transcription tool
    await page.goto('https://kome.ai/tools/youtube-transcript-generator', { waitUntil: 'domcontentloaded' });

    // Input video URL
    await page.waitForSelector('input[type="url"][name="url"]');
    await page.type('input[type="url"][name="url"]', videoUrl);

    // Submit the form
    await page.waitForSelector('button[type="submit"]');
    await page.click('button[type="submit"]');

    // Wait for transcription to load
    await page.waitForSelector('.form_transcript__lUrwL');
    const transcription = await page.$eval('.form_transcript__lUrwL', div => div.innerText);

    // Prepare array to store chapters with details
    const videoChapters = [];

    // Function to extract words from text segment
    function extractWords(text, count, fromEnd = true) {
      const words = text.split(/\s+/);
      if (fromEnd) {
        return words.slice(Math.max(words.length - count, 0)).join(' ');
      } else {
        return words.slice(0, count).join(' ');
      }
    }

    // Loop through chapters to create videoChapters
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      const nextChapter = chapters[i + 1];
      const startIndex = transcription.indexOf(chapter.chapter);
      let endIndex = transcription.length;

      if (startIndex !== -1) {
        // Find endIndex based on the next chapter
        if (nextChapter) {
          endIndex = transcription.indexOf(nextChapter.chapter, startIndex);
        }

        const chapterText = transcription.substring(startIndex + chapter.chapter.length, endIndex).trim();
        const previous50 = (i > 0) ? extractWords(transcription.substring(0, startIndex), 50) : '';

        // Calculate word count of chapterText
        const wordCountText = chapterText.split(/\s+/).length;

        videoChapters.push({ position: i + 1, chapter: chapter.chapter, time: chapter.time, url: chapter.url, text: chapterText, previous50, wordCountText });
      }
    }

    // Add next50 for each chapter based on the subsequent chapter's text
    for (let i = 0; i < videoChapters.length - 1; i++) {
      const nextChapterText = videoChapters[i + 1].text;
      videoChapters[i].next50 = extractWords(nextChapterText, 50, false);
    }

    // Prepare JSON object with videoTitle and videoUrl at the beginning
    const jsonObject = { videoTitle, videoUrl, video: videoChapters };

    await browser.close();

    res.json(jsonObject); // Return JSON response to the client

  
  } catch (e) {
    console.error(e);
    res.send(`Something went wrong while running Puppeteer: ${e}`);
  } finally {
    await browser.close();
  }
};

module.exports = { scrapeLogic };
