import fs from 'node:fs';
import * as crypto from 'crypto';

const imageDuplicates = new Map<string, string>();
const imageHashDb = new Map<string, string>();

export const writeImageDuplicatesFile = () => {
  const mapAsArray = Array.from(imageDuplicates.entries());
  const jsonString = JSON.stringify(mapAsArray, null, 2);
  fs.writeFileSync('output/image-duplicates.json', jsonString);
};

export const readImageDuplicatesFile = () => {
  if (!fs.existsSync('output/image-duplicates.json')) {
    return;
  }

  const jsonString = fs.readFileSync('output/image-duplicates.json', 'utf-8');
  const mapAsArray: any[] = JSON.parse(jsonString);
  mapAsArray.forEach(([key, value]) => imageDuplicates.set(key, value));
};

export const writeImageHashFile = () => {
  const mapAsArray = Array.from(imageHashDb.entries());
  const jsonString = JSON.stringify(mapAsArray, null, 2);
  fs.writeFileSync('output/image-hash-db.json', jsonString);
};

export const readImageHashFile = () => {
  if (!fs.existsSync('output/image-hash-db.json')) {
    return;
  }

  const jsonString = fs.readFileSync('output/image-hash-db.json', 'utf-8');
  const mapAsArray: any[] = JSON.parse(jsonString);
  mapAsArray.forEach(([key, value]) => imageHashDb.set(key, value));
};

const findMatchingImagePath = (data: Buffer, imagePath: string, datedImagePath: string): string => {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  hash.update(imagePath);
  const base64 = hash.digest('base64');

  if (imageHashDb.has(base64)) {
    // An image with the same path and data already exists, return the existing path
    const duplicatePath = imageHashDb.get(base64)!;

    // Add the new path to the duplicate map
    if (!imageDuplicates.has(datedImagePath)) {
      imageDuplicates.set(datedImagePath, duplicatePath);
    }

    return duplicatePath;
  }

  imageHashDb.set(base64, datedImagePath);
  return datedImagePath;
};

export const scrapeAndWriteImage = async (src: string, dateString: string) => {
  const searchString = '/img/';
  const imagePath = src.substring(src.indexOf(searchString) + searchString.length);
  const dir = imagePath.substring(0, imagePath.lastIndexOf('/'));
  console.log(`Found image ${imagePath} in directory ${dir}`);
  const outputDir = `output/pages/img/${dateString}/${dir}`;

  // Check the duplicate map to see if the image already exists from an earlier date
  const datedImagePath = imageDuplicates.has(imagePath) ?
    imageDuplicates.get(imagePath)! : `${dateString}/${imagePath}`;

  if (fs.existsSync(`output/pages/img/${datedImagePath}`)) {
    console.log(`Image ${datedImagePath} already exists, skipping.`);
    return datedImagePath;
  }

  const response = await fetch(src);
  let finalImagePath = datedImagePath;

  if (response?.ok) {
    const data = await response.arrayBuffer();
    if (data) {
      const buffer = Buffer.from(data);
      finalImagePath = findMatchingImagePath(buffer, imagePath, datedImagePath);
      console.log(`Final image path: ${finalImagePath}, original path: ${datedImagePath}`);

      const finalOutputDir = `output/pages/img/${finalImagePath.substring(0, finalImagePath.lastIndexOf('/'))}`;
      console.log(`Writing image to ${finalOutputDir}`);

      if (!fs.existsSync(finalOutputDir)) {
        fs.mkdirSync(finalOutputDir, {recursive: true});
      }

      fs.writeFileSync('output/pages/img/' + finalImagePath, buffer);
    }
  }

  return finalImagePath;
};
