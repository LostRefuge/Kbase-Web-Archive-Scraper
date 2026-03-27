import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import * as fs from 'node:fs';
import {
  readImageDuplicatesFile,
  readImageHashFile,
  scrapeAndWriteImage,
  writeImageDuplicatesFile,
  writeImageHashFile
} from './images';

/*
 * Notes/Todos
 *
 * Titles with / or certain special characters in them cause an error and the pages are
 * not saved - re-pull all these when fixed
 *
 * Skip pages that have already been scraped
 */

const PAGE_START = 0;
const PAGE_END = 4000;

const SPECIAL_CHAR_REGEX = /[#%&{}\\<>*?\/$!'":@+`|= ]/g;

interface PageEntry {
  timestamp: string;
  url: string;
  date: Date;
  dateString: string;
  pageRoute: string;
  itemId: string;
}

const months = [ 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC' ];

const existingPages: string[] = [];

const timestampToDateString = (timestamp: string) => {
  if (!timestamp) {
    return {
      dateString: 'NODATE',
      date: new Date(0)
    };
  }

  const year = parseInt(timestamp.substring(0, 4));
  const month = parseInt(timestamp.substring(4, 6));
  const day = parseInt(timestamp.substring(6, 8));
  // ignored for our purposes
  // const hour = parseInt(timestamp.substring(8, 10));
  // const minute = parseInt(timestamp.substring(10, 12));
  // const second = parseInt(timestamp.substring(12, 14));

  return {
    dateString: `${year}-${months[month - 1]}-${day}`,
    date: new Date(Date.UTC(year, month - 1, day))
  };
};

const getPageList = async (forcePull: boolean = false) => {
  if (fs.existsSync('output/pages')) {
    fs.readdirSync('output/pages')?.forEach(file => {
      // console.log(`Found existing page ${file}`);
      existingPages.push(file);
    });
  }

  let data: string = '';
  let writeFile: boolean = false;

  if (!forcePull && fs.existsSync('output/pagelist.txt')) {
    console.log('Found existing pagelist.txt, reading from it.');
    data = fs.readFileSync('output/pagelist.txt', { encoding: 'utf-8' });
  } else {
    const response = await fetch('http://web.archive.org/cdx/search/cdx?url=kbase.runescape.com/*&from=2006&to=2006');
    data = await response.text();
    writeFile = true;
  }

  const lines = data.split('\n');
  const pageList: PageEntry[] = [];

  lines.forEach(line => {
    const parts = line.split(' ');
    const timestamp = parts[1];
    const url = parts[2];
    const returnType = parts[3];
    const responseCode = parts[4];
    const { dateString, date } = timestampToDateString(timestamp);

    if (returnType !== 'text/html' || responseCode !== '200') return;

    const pageRoute = url.substring(url.lastIndexOf('/') + 1);

    let itemId: string;
    if (pageRoute.includes('&')) {
      if (pageRoute.indexOf('&article_id') !== -1 || pageRoute.indexOf('&cat_id') !== -1) {
        itemId = pageRoute.substring(pageRoute.indexOf('_id=') + 4);
      } else {
        itemId = pageRoute.substring(pageRoute.indexOf('_id=') + 4, pageRoute.indexOf('&'));
      }
    } else {
      itemId = pageRoute.substring(pageRoute.indexOf('_id=') + 4);
    }

    if (itemId.startsWith('&')) {
      itemId = 'NOID';
    }

    pageList.push({
      timestamp, url, dateString, date, pageRoute, itemId
    });
  });

  if (writeFile) {
    fs.writeFile('output/pagelist.txt', data, err => {
      if (err) {
        console.error(err);
      } else {
        // file written successfully
        console.log('File "pagelist.txt" written successfully.');
      }
    });
  }

  return pageList.sort((a, b) => a.date.getTime() - b.date.getTime());
};

// @todo create image hash db to prevent duplicate images

const scrapeImagesAndStylesheets = async ($: CheerioAPI, dateString: string) => {
  // img tags
  const imageTags = $('img')?.get();
  if (imageTags.length) {
    for (const el of imageTags) {
      try {
        const src = $(el).attr('src');
        if (src) {
          const imagePath = await scrapeAndWriteImage(src, dateString);
          if (imagePath) {
            $(el).attr('src', `img/${imagePath}`); // replace the src attribute with the new local path
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  // images in inline css
  const styles = $('style').get();

  for (const style of styles) {
    const styleText = $(style).text();
    const regex = /url\((.*?)\)/g;
    const matches: any[] = Array.from(styleText.matchAll(regex));
    let newStyleText = styleText;
    for (const match of matches) {
      if (!match?.[1]?.includes('/img/')) {
        continue;
      }

      const webArchiveUrl = match?.[1]?.replace(/'/g, '').replace(/"/g, '');

      if (!webArchiveUrl) {
        continue;
      }

      const imagePath = await scrapeAndWriteImage(webArchiveUrl, dateString);

      if (!imagePath) {
        continue;
      }

      newStyleText = newStyleText.replaceAll(webArchiveUrl, `img/${imagePath}`);

      console.log(`Found image ${webArchiveUrl} in style tag, replacing with local path`);
    }

    $(style).text(newStyleText);
  }

  // stylesheet tags
  const stylesheetTags = $('link[rel=stylesheet]').get();
  if (stylesheetTags.length !== 0) {
    console.log(`Stylesheet tags found: ${stylesheetTags.length}`);
  }
};

const scrapePage = async (page: PageEntry, html: string) => {
  const $ = cheerio.load(html);

  const pageType = page.url.includes('article_id') ?
    'ART' : page.url.includes('cat_id') ?
      'CAT' : 'OTHER';
  const title = pageType !== 'OTHER' ? $('.widescroll-content h1')?.text() : 'Other';
  const pageRoute = page.url.substring(page.url.lastIndexOf('/') + 1);
  let fileName: string = '';

  $('#wm-ipp-base')?.remove();
  $('#wm-ipp-print')?.remove();

  const date = page.dateString;

  if (pageType === 'OTHER') {
    console.log(`Found page /${pageRoute} on date ${date}`);
    fileName = `${date}-${pageRoute}`;
  } else {
    const cleanTitle = title.replace(SPECIAL_CHAR_REGEX, '_');
    console.log(`Found ${pageType} ID ${page.itemId} Title "${title}" on date ${date}`);
    fileName = `${page.itemId}-${date}-${pageType}-${cleanTitle}`;
  }

  fileName = `${fileName}-${page.timestamp}.html`.replace(/\?/g, '');

  console.log(`Writing ${fileName} and associated images and stylesheets...`);

  await scrapeImagesAndStylesheets($, date);

  // @todo queue and batch writing
  // @todo pull out CSS write those if they don't already exist

  fs.writeFileSync(`output/pages/${fileName}`, $.html());

  return date;
};

const run = async () => {
  console.log('Running Knowledge Base scraper...');

  readImageDuplicatesFile();
  readImageHashFile();

  const pageList = (await getPageList())
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .filter(page => page.url.includes('article_id') || page.url.includes('cat_id'));
  console.log(`Found ${pageList.length} usable pages.`);

  for (let i = PAGE_START; i < PAGE_END; i++) {
    const page = pageList[i];
    const webArchiveUrl = `https://web.archive.org/web/${page.timestamp}/${page.url}`;

    if (existingPages.find(fileName =>
      fileName.startsWith(page.itemId) && fileName.endsWith(page.timestamp + '.html')
    )) {
      // console.log(`Skipping ${page.url} (${page.timestamp}), already scraped.`);
      continue;
    }

    console.log(`${page.url} (${page.timestamp}), fetching from ${webArchiveUrl}`);

    const response = await fetch(webArchiveUrl);
    if (!response.ok) {
      console.error(`Failed to fetch ${webArchiveUrl}`);
      continue;
    }

    const html = await response.text();

    try {
      await scrapePage(page, html);
    } catch (e) {
      console.error(e);
    }
  }

  writeImageDuplicatesFile();
  writeImageHashFile();
};

try {
  run().then(() => console.log('Done.'));
} catch (e) {
  console.error(e);
}
