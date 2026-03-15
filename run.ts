import * as cheerio from 'cheerio';
import * as fs from 'node:fs';
import type { CheerioAPI } from 'cheerio/dist/commonjs/load';

console.log('Running Knowledge Base scraper...');

interface PageEntry {
  id: string;
  url: string;
}

const getPageList = async (forcePull: boolean = false) => {
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
    const id = parts[1];
    const url = parts[2];
    const returnType = parts[3];
    const responseCode = parts[4];

    if (returnType !== 'text/html' || responseCode !== '200') return;

    pageList.push({
      id, url
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

  return pageList;
};

const scrapeImagesAndStylesheets = async ($: CheerioAPI) => {
  const imageTags = $('img')?.get();
  if (imageTags.length) {
    for (const el of imageTags) {
      try {
        const src = $(el).attr('src');
        if (src) {
          const searchString = '/img/';
          const imagePath = src.substring(src.indexOf(searchString) + searchString.length);
          const dir = imagePath.substring(0, imagePath.lastIndexOf('/'));
          console.log(`Found image ${imagePath} in directory ${dir}`);
          const outputDir = `output/pages/img/${dir}`;

          if (fs.existsSync(`output/pages/img/${imagePath}`)) {
            // @todo multiple versions of images? if they change them and keep the same name...
            return;
          }

          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, {recursive: true});
          }

          const response = await fetch(src);

          if (response?.ok) {
            const data = await response.arrayBuffer();
            if (data) {
              $(el).attr('src', `img/${imagePath}`); // replace the src attribute with the new local path
              const buffer = Buffer.from(data);
              fs.writeFileSync(`output/pages/img/${imagePath}`, buffer);
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    };
  }
  const stylesheetTags = $('link[rel=stylesheet]');
};

const scrapePage = async (page: PageEntry, html: string) => {
  const $ = cheerio.load(html);
  //console.log($.text());

  // displayMonthEl displayDayEl displayYearEl
  const month = $('#displayMonthEl')?.text();
  const day = $('#displayDayEl')?.text()?.padStart(2, '0');
  const year = $('#displayYearEl')?.text();

  const pageType = page.url.includes('article_id') ?
    'ART' : page.url.includes('cat_id') ?
      'CAT' : 'OTHER';
  const title = pageType !== 'OTHER' ? $('.widescroll-content h1')?.text() : 'Other';
  const pageRoute = page.url.substring(page.url.lastIndexOf('/') + 1);
  let fileName: string = '';

  $('#wm-ipp-base')?.remove();
  $('#wm-ipp-print')?.remove();
  // $('script')?.remove(); removes kbase search scripts :(

  // This is horrendous, I know, but who cares
  let date = year ? `${year}-${month}-${day}` : 'NODATE';
  if (date === 'NODATE') {
    const searchString = 'FILE ARCHIVED ON ';
    const startIndex = html.indexOf(searchString);
    const endIndex = html.indexOf(' AND RETRIEVED FROM');
    if (startIndex !== -1 && endIndex !== -1) {
      const dateString = html.substring(startIndex + searchString.length, endIndex);
      if (dateString) {
        const parts = dateString.split(' ');
        if (parts.length === 4) {
          const commentMonth = parts[1];
          const commentDay = parts[2].substring(0, parts[2].length - 1); // remove trailing comma
          const commentYear = parts[3];
          if (commentMonth && commentDay && commentYear) {
            date = `${commentYear}-${commentMonth.toUpperCase()}-${commentDay}`;
          }
        }
      }
    }
  }

  if (pageType === 'OTHER') {
    console.log(`Found page /${pageRoute} on date ${date}`);
    fileName = `${date}-${pageRoute}`;
  } else {
    let itemId: string = '-1';
    if (pageRoute.includes('&')) {
      itemId = pageRoute.substring(pageRoute.indexOf('_id=') + 4, pageRoute.indexOf('&'));
    } else {
      itemId = pageRoute.substring(pageRoute.indexOf('_id=') + 4);
    }

    const cleanTitle = title.replace(/ /g, '_');
    console.log(`Found ${pageType} ID ${itemId} Title "${title}" on date ${date}`);
    fileName = `${itemId.startsWith('&') ? 'NOID' : itemId}-${date}-${pageType}-${cleanTitle}`;
  }

  fileName = `${fileName}-${page.id}.html`.replace(/\?/g, '');

  console.log(`Writing ${fileName} and associated images and stylesheets...`);

  await scrapeImagesAndStylesheets($);

  // @todo queue and batch writing
  // @todo pull out CSS and images and write those if they don't already exist

  fs.writeFileSync(`output/pages/${fileName}`, $.html());

  return date;
};

const run = async () => {
  const pageList = (await getPageList())
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter(page => page.url.includes('article_id') || page.url.includes('cat_id'));
  console.log(`Found ${pageList.length} usable pages.`);
  // pageList.forEach(page => {
  //   console.log(`${page.url} (${page.id})`);
  // });

  //let stop = false;
  //let i = 0;
  //while (!stop) {
  for (let i = 0; i < 1; i++) {
    const page = pageList[i];
    // if (page.id !== '20060707005402') {
    //   continue;
    // }
    const webArchiveUrl = `https://web.archive.org/web/${page.id}/${page.url}`;
    console.log(`${page.url} (${page.id}), fetching from ${webArchiveUrl}`);

    const response = await fetch(webArchiveUrl);
    if (!response.ok) {
      console.error(`Failed to fetch ${webArchiveUrl}`);
      continue;
    }

    const html = await response.text();

    try {
      const date = await scrapePage(page, html);
      // if (date !== 'NODATE') {
      //   stop = true;
      // }
    } catch (e) {
      console.error(e);
    }
    //i++;
  }
};

try {
  run().then(() => console.log('Done.'));
} catch (e) {
  console.error(e);
}
