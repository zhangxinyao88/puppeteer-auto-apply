const puppeteer = require('puppeteer');
const ObjectsToCsv = require('objects-to-csv')
const fs = require('fs');

// function writeToFile(arr, filename) {
//   var ws = fs.createWriteStream(filename);
//   ws.on('error', function(err) { 
//     /* error handling */ 
//     console.err("writing err: ", err);
//   });
//   arr.forEach(v =>  ws.write(`${JSON.stringify(v)}\r\n`));
//   console.log("Output saved to ", filename);
//   ws.end();
// }


/* Getting jobs arr - containing textInfo and URL
1. query all job board - title, location, company, url 
2. query all apply with indeed
3. apply all the jobs in the query
4. put success and failure instances into separate csv file in local directory
*/ 
async function getPropertyValue(element, propertyName) {
  const property = await element.getProperty(propertyName);
  return await property.jsonValue();
}

async function loadJobs(page, jobs) {
  const jobboard_arr = await page.$$("div[class='jobsearch-SerpJobCard unifiedRow row result clickcard']");
  console.log("jobboard array: ", jobboard_arr.length);

  const jobsMapping = jobboard_arr.map(async (jobboard) => {
    const easyApply = await jobboard.$("td[class='jobCardShelfItem indeedApply']");
    //xpath does not work well in getting attributes
    //let title = await jobboard.$x("/html/body/table[2]/tbody/tr/td/table/tbody/tr//h2/a");
    let jobTitle = await jobboard.$("a[data-tn-element='jobTitle']");
    let companyName = await jobboard.$("a[data-tn-element='companyName']");
    if (!companyName) {
      companyName = await jobboard.$("span[class='company']");
    }
    let location = await jobboard.$("[class='location accessible-contrast-color-location']");

    if (easyApply && jobTitle) {
      //console.log("is EASY APPLY")
      // Get text info
      const titleText = await getPropertyValue(jobTitle, 'innerText');
      const title_link = await (await jobTitle.getProperty('href')).jsonValue();
      let companyNameText = "null";
      let locationText = "null";

      if (companyName) {
        companyNameText = await getPropertyValue(companyName, 'innerText');
      }
      if (location) {
        locationText = await getPropertyValue(location, 'innerText');
      }
    
      //const href = await page.evaluate(anchor => anchor.getAttribute('href'), title[0]);
      jobs.push({titleText, companyNameText, locationText, title_link});
    }
    else {
      //console.log("is NOT Easy Apply");
    }
  });

  await Promise.all(jobsMapping);
}

// Step 2: Applying jobs
async function applyJobs(page) {
  // Click Apply, wait for navigation won't help me find the continue button
  await Promise.all([
    page.waitForNavigation({waitUntil: 'networkidle0'}),
    page.waitForTimeout(3000),
    page.click("div[class='jobsearch-IndeedApplyButton-contentWrapper']")
  ]);
  
  let isApplied = await page.$x("//h1[contains(text(), 've applied to this job')]");
  if (isApplied[0]) {
    console.log("Already Applied, return");
    return true;
  }

  //let k = 0;
  let button = [];
  while (true) {
    //console.log("Click step: ", k++);
    //button = await page.$x("//button");
    button = await page.$x("/html/body/div[2]/div/div/div/main/div/div[2]/div/div/div[2]/div/button")
    //console.log(button, "buttton done");
    //console.log("button length: ", button.length);
    
    if (!button[0]) {
      break;
    }
    // Determine if Button is disabled (meanning some required questions are not filled)
    //const href = await page.evaluate(anchor => anchor.getAttribute('href'), title[0]);
    const isDisabled = await page.evaluate(el => el.disabled, button[0]);
    if (isDisabled) {
      console.log("Continue button is disabled");
      //Automatic appy failed, moving to error array
      return false;
    }
    
    try {
      await Promise.all([
        page.waitForTimeout(2000),
        button[0].click()
      ]);
    } catch (e) {
      console.error("Automatic appy failed, moving to error array");
      return false;
    }
  }
  // Determine whether successfully applied
  const success = await page.$x("//h1[contains(text(), 'Your application has been submitted!')]");
  if (success[0]) {
    console.log("apply succeed!");
    return true;
  } else {
    console.log("apply failed unfortunately..");
    return false;
  }
}

(async () => {
  // testing user data
  //const browser = await puppeteer.launch({headless: false, userDataDir:"C:\\Users\\Zhang\\PycharmProjects\\auto_apply\\userdata"});
  const browser = await puppeteer.launch({headless: false, userDataDir:"C:\\Users\\Zhang\\PycharmProjects\\auto_apply\\userdata_lucida"});
  const page = await browser.newPage();
  let jobs = []
  let jobs_success = []
  let jobs_fail = []
  link_prefix = "https://www.indeed.com/jobs?q=Data+Analyst&l=New+York%2C+NY&start=" // this suffix can be 10, 20, etc
  for (let i = 0; i < 100; i += 10) {
    link = link_prefix + i;
    console.log("page: ", link);
    await page.goto(link);
    await loadJobs(page, jobs);
  }

  console.log("jobs length: ", jobs.length);

  // Step 2: Applying these jobs
  //console.log("Start Applying: ", jobs);
  for (let i = 0; i < jobs.length; i++) {
    page.on('dialog', async dialog => {
      console.log('listening dialogs');
      await dialog.accept();
    });    
    console.log("Applying job number ", i, " - ", jobs[i].titleText, "from company - ", jobs[i].companyNameText, "at ", jobs[i].locationText);
    await page.goto(jobs[i].title_link);
    if (await applyJobs(page)) {
      console.log("apply succeeded, moving to success bucket");
      jobs_success.push(jobs[i]);
    }
    else {
      console.log("apply failed, moving to error bucket");
      //page = await browser.newPage();
      jobs_fail.push(jobs[i]);
    }
  }

  console.log("successfully applied number: ", jobs_success.length, "\n failed number: ", jobs_fail.length);
  
  const csv_success = new ObjectsToCsv(jobs_success)
  const csv_fail = new ObjectsToCsv(jobs_fail)

  await csv_success.toDisk('./success.csv', { append: true })
  await csv_fail.toDisk('./fail.csv', { append: true })

  console.log("fail bucket: ", jobs_fail, "Please fill them out by yourself");
  for (let j = 0; j < jobs_fail.length; j++) {
    const page = await browser.newPage();
    page.goto(jobs[j].title_link);
  }
  console.log("DONE!");
})();