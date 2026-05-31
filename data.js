/* ============================================================
   CITY-TO-CITY DISTANCE TABLE (driving miles, approx.)
   Improvement 1: auto-fill distance when origin + dest are picked.
   Keys are canonical destination names from DESTINATIONS array.
   Inner keys are origin names; value is driving miles (one-way).
   ============================================================ */

const CITY_DISTANCES = {
  'New York City, NY': {
    'Boston, MA': 215, 'Philadelphia, PA': 95, 'Washington DC, DC': 225,
    'Baltimore, MD': 185, 'Providence, RI': 180, 'Hartford, CT': 115,
    'Albany, NY': 150, 'Buffalo, NY': 370, 'Pittsburgh, PA': 370,
    'Newark, NJ': 16, 'Atlantic City, NJ': 125, 'Chicago, IL': 790,
    'Miami, FL': 1280, 'Orlando, FL': 1090, 'Nashville, TN': 900,
    'Charlotte, NC': 630, 'Richmond, VA': 350, 'Cleveland, OH': 460,
    'Detroit, MI': 590, 'Toronto, ON': 500, 'Montreal, QC': 370,
  },
  'Los Angeles, CA': {
    'San Diego, CA': 120, 'San Francisco, CA': 380, 'Las Vegas, NV': 270,
    'Phoenix, AZ': 370, 'Portland, OR': 1085, 'Seattle, WA': 1135,
    'Denver, CO': 1020, 'Salt Lake City, UT': 690, 'Tucson, AZ': 490,
    'Santa Barbara, CA': 95, 'Bakersfield, CA': 110, 'Sacramento, CA': 385,
    'Fresno, CA': 220, 'Palm Springs, CA': 110, 'Tijuana, Mexico': 140,
    'Grand Canyon, AZ': 490, 'Disneyland, CA': 35, 'Malibu, CA': 30,
  },
  'Chicago, IL': {
    'Milwaukee, WI': 92, 'Indianapolis, IN': 180, 'Detroit, MI': 280,
    'Minneapolis, MN': 410, 'St. Louis, MO': 300, 'Kansas City, MO': 520,
    'Nashville, TN': 475, 'Cleveland, OH': 345, 'Columbus, OH': 360,
    'Cincinnati, OH': 300, 'Louisville, KY': 305, 'Madison, WI': 145,
    'Green Bay, WI': 210, 'Rockford, IL': 90, 'Springfield, IL': 200,
    'Des Moines, IA': 335, 'Omaha, NE': 490, 'Grand Rapids, MI': 185,
    'New York City, NY': 790, 'Toronto, ON': 540,
  },
  'Las Vegas, NV': {
    'Los Angeles, CA': 270, 'Phoenix, AZ': 300, 'San Diego, CA': 330,
    'Salt Lake City, UT': 420, 'Denver, CO': 750, 'San Francisco, CA': 570,
    'Reno, NV': 440, 'Grand Canyon, AZ': 280, 'Zion, UT': 160,
    'Bryce Canyon, UT': 260, 'Hoover Dam, NV': 30, 'Death Valley, CA': 120,
    'Palm Springs, CA': 240, 'Flagstaff, AZ': 225, 'Sedona, AZ': 250,
  },
  'Miami, FL': {
    'Orlando, FL': 235, 'Tampa, FL': 280, 'Fort Lauderdale, FL': 30,
    'Key West, FL': 160, 'Jacksonville, FL': 340, 'Atlanta, GA': 660,
    'Charlotte, NC': 730, 'Savannah, GA': 505, 'Nashville, TN': 870,
    'New York City, NY': 1280, 'Washington DC, DC': 1060, 'Chicago, IL': 1380,
    'Cancún, Mexico': 550, 'Havana, Cuba': 230, 'Nassau, Bahamas': 190,
  },
  'Orlando, FL': {
    'Miami, FL': 235, 'Tampa, FL': 85, 'Jacksonville, FL': 140,
    'Daytona Beach, FL': 60, 'Key West, FL': 355, 'Tallahassee, FL': 260,
    'Atlanta, GA': 440, 'Savannah, GA': 310, 'Charlotte, NC': 500,
    'New York City, NY': 1090, 'Washington DC, DC': 860, 'Nashville, TN': 650,
    'Disney World, FL': 20, 'Clearwater, FL': 100,
  },
  'Nashville, TN': {
    'Memphis, TN': 210, 'Knoxville, TN': 180, 'Chattanooga, TN': 135,
    'Louisville, KY': 175, 'Atlanta, GA': 250, 'Birmingham, AL': 190,
    'Charlotte, NC': 410, 'St. Louis, MO': 310, 'Chicago, IL': 475,
    'Cincinnati, OH': 270, 'Indianapolis, IN': 290, 'Cleveland, OH': 410,
    'Detroit, MI': 520, 'New York City, NY': 900, 'Miami, FL': 870,
    'Dallas, TX': 670, 'New Orleans, LA': 510,
  },
  'Seattle, WA': {
    'Portland, OR': 175, 'Spokane, WA': 280, 'Vancouver, BC': 140,
    'Tacoma, WA': 35, 'Olympia, WA': 60, 'Bellingham, WA': 90,
    'Victoria, BC': 90, 'San Francisco, CA': 810, 'Los Angeles, CA': 1135,
    'Denver, CO': 1320, 'Salt Lake City, UT': 840, 'Boise, ID': 500,
    'Missoula, MT': 490, 'Glacier National Park, MT': 370, 'Olympic, WA': 100,
  },
  'Denver, CO': {
    'Colorado Springs, CO': 70, 'Boulder, CO': 30, 'Aspen, CO': 200,
    'Vail, CO': 100, 'Fort Collins, CO': 65, 'Breckenridge, CO': 90,
    'Estes Park, CO': 65, 'Telluride, CO': 330, 'Pueblo, CO': 110,
    'Salt Lake City, UT': 525, 'Las Vegas, NV': 750, 'Albuquerque, NM': 450,
    'Kansas City, MO': 600, 'Dallas, TX': 990, 'Chicago, IL': 920,
    'Seattle, WA': 1320, 'Los Angeles, CA': 1020,
  },
  'Boston, MA': {
    'New York City, NY': 215, 'Providence, RI': 50, 'Hartford, CT': 100,
    'Portland, ME': 110, 'Cape Cod, MA': 70, 'Manchester, NH': 55,
    'Burlington, VT': 210, 'Albany, NY': 165, 'Worcester, MA': 45,
    'Springfield, MA': 90, 'Concord, NH': 75, 'Bar Harbor, ME': 260,
    'Acadia, ME': 270, 'Nantucket, MA': 125, 'Martha\'s Vineyard, MA': 85,
    'Newport, RI': 70, 'Philadelphia, PA': 310, 'Washington DC, DC': 440,
  },
  'New Orleans, LA': {
    'Baton Rouge, LA': 80, 'Lafayette, LA': 135, 'Biloxi, MS': 90,
    'Gulfport, MS': 80, 'Mobile, AL': 145, 'Jackson, MS': 185,
    'Memphis, TN': 395, 'Nashville, TN': 510, 'Atlanta, GA': 470,
    'Houston, TX': 350, 'Dallas, TX': 500, 'Miami, FL': 875,
  },
  'San Francisco, CA': {
    'Los Angeles, CA': 380, 'Sacramento, CA': 90, 'San Jose, CA': 50,
    'Oakland, CA': 15, 'Santa Cruz, CA': 75, 'Monterey, CA': 120,
    'Napa, CA': 55, 'Lake Tahoe, CA': 195, 'Yosemite, CA': 190,
    'Portland, OR': 640, 'Seattle, WA': 810, 'Las Vegas, NV': 570,
    'Salt Lake City, UT': 750, 'Reno, NV': 220, 'San Diego, CA': 500,
  },
  'Washington DC, DC': {
    'Baltimore, MD': 40, 'Richmond, VA': 110, 'Philadelphia, PA': 140,
    'New York City, NY': 225, 'Annapolis, MD': 35, 'Alexandria, VA': 8,
    'Charlottesville, VA': 115, 'Shenandoah, VA': 105, 'Virginia Beach, VA': 200,
    'Pittsburgh, PA': 245, 'Charlotte, NC': 390, 'Raleigh, NC': 305,
    'Boston, MA': 440, 'Chicago, IL': 700, 'Miami, FL': 1060,
  },
  'Atlanta, GA': {
    'Savannah, GA': 250, 'Charlotte, NC': 245, 'Nashville, TN': 250,
    'Birmingham, AL': 150, 'Chattanooga, TN': 110, 'Knoxville, TN': 175,
    'Asheville, NC': 210, 'Columbia, SC': 215, 'Charleston, SC': 320,
    'Jacksonville, FL': 340, 'Orlando, FL': 440, 'Miami, FL': 660,
    'New Orleans, LA': 470, 'Dallas, TX': 780, 'Chicago, IL': 720,
  },
  'Phoenix, AZ': {
    'Scottsdale, AZ': 15, 'Tucson, AZ': 115, 'Sedona, AZ': 115,
    'Flagstaff, AZ': 145, 'Grand Canyon, AZ': 230, 'Las Vegas, NV': 300,
    'Los Angeles, CA': 370, 'San Diego, CA': 355, 'Denver, CO': 600,
    'Albuquerque, NM': 465, 'Salt Lake City, UT': 650, 'El Paso, TX': 430,
  },
  'Grand Canyon, AZ': {
    'Phoenix, AZ': 230, 'Las Vegas, NV': 280, 'Sedona, AZ': 115,
    'Flagstaff, AZ': 80, 'Los Angeles, CA': 490, 'Salt Lake City, UT': 400,
    'Denver, CO': 600, 'Zion, UT': 165, 'Bryce Canyon, UT': 220,
    'Monument Valley, AZ': 185, 'Page, AZ': 130,
  },
  'Vancouver, BC': {
    'Seattle, WA': 140, 'Victoria, BC': 75, 'Whistler, BC': 75,
    'Kelowna, BC': 390, 'Calgary, AB': 600, 'Bellingham, WA': 55,
    'Portland, OR': 315, 'San Francisco, CA': 1080, 'Banff, AB': 540,
  },
  'Toronto, ON': {
    'Niagara Falls, ON': 130, 'Hamilton, ON': 70, 'Ottawa, ON': 450,
    'Montreal, QC': 540, 'Kingston, ON': 265, 'Detroit, MI': 375,
    'Buffalo, NY': 155, 'New York City, NY': 500, 'Chicago, IL': 540,
    'Algonquin Park, ON': 250, 'Muskoka, ON': 170,
  },
  'Montreal, QC': {
    'Quebec City, QC': 255, 'Ottawa, ON': 195, 'Toronto, ON': 540,
    'Burlington, VT': 100, 'Albany, NY': 235, 'Boston, MA': 310,
    'New York City, NY': 370, 'Gatineau, QC': 195, 'Laurentians, QC': 90,
  },
  'Cancún, Mexico': {
    'Playa del Carmen, Mexico': 45, 'Tulum, Mexico': 80, 'Merida, Mexico': 200,
    'Cozumel, Mexico': 65, 'Isla Mujeres, Mexico': 20, 'Akumal, Mexico': 65,
    'Holbox, Mexico': 140, 'Chichen Itza, Mexico': 120,
  },
  'Banff, AB': {
    'Calgary, AB': 130, 'Lake Louise, AB': 55, 'Canmore, AB': 25,
    'Jasper, AB': 290, 'Edmonton, AB': 395, 'Vancouver, BC': 850,
    'Kelowna, BC': 475, 'Glacier National Park, MT': 415,
  },
};

/* ============================================================
   DISTANCE LOOKUP FUNCTION (Improvement 1)
   Looks up distance between two cities bidirectionally.
   Returns miles or null if unknown.
   ============================================================ */
function lookupDistance(origin, destination) {
  if (!origin || !destination) return null;
  const destTable = CITY_DISTANCES[destination];
  if (destTable && destTable[origin] != null) return destTable[origin];
  // Check reverse
  const origTable = CITY_DISTANCES[origin];
  if (origTable && origTable[destination] != null) return origTable[destination];
  return null;
}



const DESTINATIONS = [
  // Florida
  'Miami, FL', 'Orlando, FL', 'Tampa, FL', 'Key West, FL', 'Clearwater, FL',
  'Naples, FL', 'Fort Lauderdale, FL', 'Jacksonville, FL', 'Pensacola, FL', 'Panama City, FL',
  // California
  'Los Angeles, CA', 'San Francisco, CA', 'San Diego, CA', 'Lake Tahoe, CA', 'Yosemite, CA',
  'Santa Monica, CA', 'Malibu, CA', 'San Jose, CA', 'Long Beach, CA', 'Disneyland, CA',
  // New York
  'New York City, NY', 'Buffalo, NY', 'Rochester, NY', 'Albany, NY', 'Syracuse, NY',
  'Niagara Falls, NY', 'The Hamptons, NY', 'Ithaca, NY', 'Lake Placid, NY', 'Saratoga Springs, NY',
  // Texas
  'Houston, TX', 'Dallas, TX', 'Austin, TX', 'San Antonio, TX', 'Fort Worth, TX',
  'Galveston, TX', 'South Padre Island, TX', 'El Paso, TX', 'Corpus Christi, TX', 'Amarillo, TX',
  // Arizona
  'Phoenix, AZ', 'Scottsdale, AZ', 'Sedona, AZ', 'Tucson, AZ', 'Grand Canyon, AZ',
  'Flagstaff, AZ', 'Lake Havasu, AZ', 'Prescott, AZ', 'Mesa, AZ', 'Tempe, AZ',
  // Colorado
  'Denver, CO', 'Boulder, CO', 'Aspen, CO', 'Vail, CO', 'Colorado Springs, CO',
  'Fort Collins, CO', 'Telluride, CO', 'Durango, CO', 'Estes Park, CO', 'Breckenridge, CO',
  // Nevada
  'Las Vegas, NV', 'Reno, NV', 'Lake Tahoe, NV', 'Henderson, NV', 'North Las Vegas, NV',
  // Utah
  'Salt Lake City, UT', 'Moab, UT', 'Park City, UT', 'Zion, UT', 'Arches, UT',
  'Bryce Canyon, UT', 'St. George, UT', 'Provo, UT', 'Ogden, UT', 'Canyonlands, UT',
  // New Mexico
  'Santa Fe, NM', 'Albuquerque, NM', 'Taos, NM', 'Carlsbad, NM', 'Silver City, NM',
  // Washington
  'Seattle, WA', 'Vancouver, WA', 'Tacoma, WA', 'Spokane, WA', 'Bellingham, WA',
  'San Juan Islands, WA', 'Port Townsend, WA', 'Walla Walla, WA', 'Tri-Cities, WA', 'Olympia, WA',
  // Oregon
  'Portland, OR', 'Bend, OR', 'Eugene, OR', 'Salem, OR', 'Crater Lake, OR',
  'Cannon Beach, OR', 'Hood River, OR', 'Ashland, OR', 'Newport, OR', 'Sunriver, OR',
  // Idaho
  'Boise, ID', 'Coeur d\'Alene, ID', 'Sun Valley, ID', 'Ketchum, ID', 'Moscow, ID',
  'Stanley, ID', 'Sandpoint, ID', 'Pocatello, ID', 'Twin Falls, ID', 'McCall, ID',
  // Montana
  'Missoula, MT', 'Bozeman, MT', 'Billings, MT', 'Big Sky, MT', 'Whitefish, MT',
  'Glacier National Park, MT', 'West Yellowstone, MT', 'Butte, MT', 'Helena, MT', 'Red Lodge, MT',
  // Wyoming
  'Jackson, WY', 'Cheyenne, WY', 'Cody, WY', 'Laramie, WY', 'Casper, WY',
  'Yellowstone, WY', 'Grand Teton, WY', 'Sheridan, WY', 'Dubois, WY', 'Jackson Hole, WY',
  // Alaska
  'Anchorage, AK', 'Juneau, AK', 'Fairbanks, AK', 'Ketchikan, AK', 'Denali, AK',
  // Hawaii
  'Honolulu, HI', 'Maui, HI', 'Big Island, HI', 'Kauai, HI', 'Lanai, HI',
  'Hilo, HI', 'Kona, HI', 'Lahaina, HI', 'Wailea, HI', 'Hanauma Bay, HI',
  // Illinois
  'Chicago, IL', 'Springfield, IL', 'Urbana, IL', 'Galena, IL', 'Starved Rock, IL',
  // Indiana
  'Indianapolis, IN', 'Fort Wayne, IN', 'Evansville, IN', 'South Bend, IN', 'Bloomington, IN',
  // Ohio
  'Columbus, OH', 'Cincinnati, OH', 'Cleveland, OH', 'Sandusky, OH', 'Hocking Hills, OH',
  'Toledo, OH', 'Akron, OH', 'Canton, OH', 'Put-in-Bay, OH', 'Marietta, OH',
  // Michigan
  'Detroit, MI', 'Grand Rapids, MI', 'Traverse City, MI', 'Mackinac Island, MI', 'Petoskey, MI',
  'Dearborn, MI', 'Lansing, MI', 'Ann Arbor, MI', 'Marquette, MI', 'Sleeping Bear Dunes, MI',
  // Minnesota
  'Minneapolis, MN', 'St. Paul, MN', 'Duluth, MN', 'International Falls, MN', 'Grand Marais, MN',
  'St. Cloud, MN', 'Rochester, MN', 'Bemidji, MN', 'Brainerd, MN', 'Ely, MN',
  // Wisconsin
  'Milwaukee, WI', 'Madison, WI', 'Green Bay, WI', 'Door County, WI', 'Lake Geneva, WI',
  'Galena, WI', 'Wisconsin Dells, WI', 'Bayfield, WI', 'Egg Harbor, WI', 'Fish Creek, WI',
  // Iowa
  'Des Moines, IA', 'Cedar Rapids, IA', 'Dubuque, IA', 'Davenport, IA', 'Sioux City, IA',
  // Missouri
  'St. Louis, MO', 'Kansas City, MO', 'Branson, MO', 'Springfield, MO', 'Columbia, MO',
  'Ozark, MO', 'Joplin, MO', 'Cape Girardeau, MO', 'Hannibal, MO', 'Hermann, MO',
  // Arkansas
  'Hot Springs, AR', 'Little Rock, AR', 'Eureka Springs, AR', 'Fort Smith, AR', 'Fayetteville, AR',
  // Louisiana
  'New Orleans, LA', 'Baton Rouge, LA', 'Lafayette, LA', 'Shreveport, LA', 'Natchitoches, LA',
  // Tennessee
  'Nashville, TN', 'Memphis, TN', 'Gatlinburg, TN', 'Knoxville, TN', 'Pigeon Forge, TN',
  'Chattanooga, TN', 'Johnson City, TN', 'Branson, TN', 'Sevierville, TN', 'Murfreesboro, TN',
  // Kentucky
  'Louisville, KY', 'Lexington, KY', 'Frankfort, KY', 'Covington, KY', 'Bowling Green, KY',
  // Mississippi
  'Jackson, MS', 'Biloxi, MS', 'Gulfport, MS', 'Tupelo, MS', 'Hattiesburg, MS',
  // Alabama
  'Mobile, AL', 'Birmingham, AL', 'Gulf Shores, AL', 'Destin, AL', 'Montgomery, AL',
  'Huntsville, AL', 'Auburn, AL', 'Orange Beach, AL', 'Tuscaloosa, AL', 'Florence, AL',
  // Georgia
  'Atlanta, GA', 'Savannah, GA', 'St. Simons Island, GA', 'Tybee Island, GA', 'Brunswick, GA',
  'Athens, GA', 'Augusta, GA', 'Macon, GA', 'Helen, GA', 'Dahlonega, GA',
  // South Carolina
  'Charleston, SC', 'Myrtle Beach, SC', 'Hilton Head, SC', 'Greenville, SC', 'Beaufort, SC',
  'Kiawah Island, SC', 'Aiken, SC', 'Columbia, SC', 'Seabrook, SC', 'Folly Beach, SC',
  // North Carolina
  'Charlotte, NC', 'Raleigh, NC', 'Outer Banks, NC', 'Asheville, NC', 'Wilmington, NC',
  'Greensboro, NC', 'Durham, NC', 'Chapel Hill, NC', 'Boone, NC', 'Pinehurst, NC',
  // Virginia
  'Richmond, VA', 'Virginia Beach, VA', 'Arlington, VA', 'Alexandria, VA', 'Charlottesville, VA',
  'Shenandoah, VA', 'Williamsburg, VA', 'Roanoke, VA', 'Blacksburg, VA', 'Leesburg, VA',
  // West Virginia
  'Charleston, WV', 'Harpers Ferry, WV', 'Beckley, WV', 'Wheeling, WV', 'Huntington, WV',
  // Maryland
  'Baltimore, MD', 'Annapolis, MD', 'Ocean City, MD', 'Frederick, MD', 'Bethesda, MD',
  'Chevy Chase, MD', 'Frostburg, MD', 'Cumberland, MD', 'Salisbury, MD', 'Hagerstown, MD',
  // Delaware
  'Wilmington, DE', 'Dover, DE', 'Rehoboth Beach, DE', 'Bethany Beach, DE', 'Lewes, DE',
  // Pennsylvania
  'Philadelphia, PA', 'Pittsburgh, PA', 'Hershey, PA', 'Pocono Mountains, PA', 'Gettysburg, PA',
  'Lancaster, PA', 'Valley Forge, PA', 'Jim Thorpe, PA', 'Allentown, PA', 'Harrisburg, PA',
  // New Jersey
  'Atlantic City, NJ', 'Cape May, NJ', 'Point Pleasant, NJ', 'Seaside Heights, NJ', 'Princeton, NJ',
  'Jersey Shore, NJ', 'Hoboken, NJ', 'Newark, NJ', 'Asbury Park, NJ', 'Ocean City, NJ',
  // Connecticut
  'Hartford, CT', 'New Haven, CT', 'Stamford, CT', 'Greenwich, CT', 'Mystic, CT',
  'Newport, CT', 'Groton, CT', 'Bridgeport, CT', 'Danbury, CT', 'Waterbury, CT',
  // Rhode Island
  'Providence, RI', 'Newport, RI', 'Narragansett, RI', 'Block Island, RI', 'Warwick, RI',
  'Cranston, RI', 'Woonsocket, RI', 'Kingston, RI', 'Westerly, RI', 'Bristol, RI',
  // Massachusetts
  'Boston, MA', 'Cape Cod, MA', 'Martha\'s Vineyard, MA', 'Nantucket, MA', 'Worcester, MA',
  'Springfield, MA', 'Salem, MA', 'Plymouth, MA', 'Berkshires, MA', 'Provincetown, MA',
  // Vermont
  'Burlington, VT', 'Stowe, VT', 'Montpelier, VT', 'Woodstock, VT', 'Manchester, VT',
  'Brattleboro, VT', 'Bennington, VT', 'Middlebury, VT', 'Rutland, VT', 'Quechee, VT',
  // New Hampshire
  'Manchester, NH', 'Portsmouth, NH', 'Concord, NH', 'Lake Winnipesaukee, NH', 'Franconia, NH',
  'Hanover, NH', 'North Conway, NH', 'Rye, NH', 'Keene, NH', 'Dover, NH',
  // Maine
  'Portland, ME', 'Acadia, ME', 'Bar Harbor, ME', 'Augusta, ME', 'Rockland, ME',
  'Boothbay, ME', 'Camden, ME', 'Bangor, ME', 'South Portland, ME', 'Ogunquit, ME',
  // Canada - British Columbia
  'Vancouver, BC', 'Victoria, BC', 'Whistler, BC', 'Kelowna, BC', 'Kamloops, BC',
  'Nanaimo, BC', 'Prince Rupert, BC', 'Fernie, BC', 'Sun Peaks, BC', 'Tofino, BC',
  // Canada - Alberta
  'Calgary, AB', 'Edmonton, AB', 'Banff, AB', 'Lake Louise, AB', 'Canmore, AB',
  'Jasper, AB', 'Red Deer, AB', 'Lethbridge, AB', 'Fort McMurray, AB', 'Lake Minnewanka, AB',
  // Canada - Saskatchewan
  'Regina, SK', 'Saskatoon, SK', 'Moose Jaw, SK', 'Prince Albert, SK', 'Nipawin, SK',
  // Canada - Manitoba
  'Winnipeg, MB', 'Churchill, MB', 'Brandon, MB', 'Thompson, MB', 'Portage la Prairie, MB',
  // Canada - Ontario
  'Toronto, ON', 'Ottawa, ON', 'Niagara Falls, ON', 'Windsor, ON', 'Hamilton, ON',
  'Mississauga, ON', 'London, ON', 'Kingston, ON', 'Thunder Bay, ON', 'Algonquin Park, ON',
  // Canada - Quebec
  'Montreal, QC', 'Quebec City, QC', 'Gatineau, QC', 'Sherbrooke, QC', 'Trois-Rivières, QC',
  'Laval, QC', 'Longueuil, QC', 'Laurentians, QC', 'Eastern Townships, QC', 'Montebello, QC',
  // Canada - Maritimes
  'Halifax, NS', 'Moncton, NB', 'Saint John, NB', 'Fredericton, NB', 'Charlottetown, PEI',
  'Cape Breton, NS', 'Bay of Fundy, NB', 'Peggy\'s Cove, NS', 'Cavendish Beach, PEI', 'Windsor, NS',
  // Canada - Newfoundland
  'St. John\'s, NL', 'Gros Morne, NL', 'Corner Brook, NL', 'Twillingate, NL', 'Conception Bay, NL',
  // Mexico - Yucatan
  'Cancún, Mexico', 'Playa del Carmen, Mexico', 'Tulum, Mexico', 'Cozumel, Mexico', 'Puerto Morelos, Mexico',
  'Merida, Mexico', 'Akumal, Mexico', 'Xel-Ha, Mexico', 'Isla Mujeres, Mexico', 'Holbox, Mexico',
  // Mexico - Pacific
  'Puerto Vallarta, Mexico', 'Los Cabos, Mexico', 'Mazatlán, Mexico', 'Acapulco, Mexico', 'Huatulco, Mexico',
  'Sayulita, Mexico', 'Nuevo Vallarta, Mexico', 'Jalisco, Mexico', 'Manzanillo, Mexico', 'Zihuatanejo, Mexico',
  // Mexico - Northern
  'Monterrey, Mexico', 'Chihuahua, Mexico', 'Hermosillo, Mexico', 'Juarez, Mexico', 'Saltillo, Mexico',
  // Mexico - Central
  'Mexico City, Mexico', 'Guadalajara, Mexico', 'Puebla, Mexico', 'San Miguel de Allende, Mexico', 'Guanajuato, Mexico',
  'Querétaro, Mexico', 'Oaxaca, Mexico', 'Veracruz, Mexico', 'Xalapa, Mexico', 'Zacatecas, Mexico',
  // Additional US Popular Destinations
  'New Orleans, LA', 'Washington DC, DC', 'Philadelphia, PA', 'Boston, MA', 'Miami, FL',
  'Disney World, FL', 'Universal Studios, FL', 'Las Vegas, NV', 'Hollywood, CA', 'Disneyland, CA',
  'Venice Beach, CA', 'Yellowstone, WY', 'Smoky Mountains, TN', 'Arches, UT', 'Bryce Canyon, UT',
  'Grand Canyon, AZ', 'Monument Valley, AZ', 'Death Valley, CA', 'Joshua Tree, CA', 'Redwoods, CA',
  'Channel Islands, CA', 'Kings Canyon, CA', 'Sequoia, CA', 'Crater Lake, OR', 'Mount Rainier, WA',
  'Olympic, WA', 'North Cascades, WA', 'Badlands, SD', 'Mount Rushmore, SD', 'Glacier, MT',
  'Great Falls, MT', 'Beartooth Pass, MT', 'Bitterroot Valley, MT', 'Wallowa Valley, OR', 'Smith Rock, OR',
  'Deschutes River, OR', 'Columbia River Gorge, OR', 'Cape Perpetua, OR', 'Oregon Coast, OR', 'Painted Hills, OR',
  // Additional Canadian Destinations
  'Moraine Lake, AB', 'Peyto Lake, AB', 'Johnston Canyon, AB', 'Athabasca Falls, AB', 'Sunwapta Falls, AB',
  'Waterfall Lake, AB', 'Lake Louise Village, AB', 'Bow River, AB', 'Columbia Icefields, AB', 'Maligne Lake, AB',
  'Pemberton, BC', 'Squamish, BC', 'Garibaldi Park, BC', 'Cypress Mountain, BC', 'Grouse Mountain, BC',
  // Fill remaining with secondary tier destinations
  'Sedona, AZ', 'Sedona, AZ', 'Flagstaff, AZ', 'Flagstaff, AZ', 'Jerome, AZ',
  'Payson, AZ', 'Prescott Valley, AZ', 'Snowflake, AZ', 'Show Low, AZ', 'Pinetop-Lakeside, AZ',
  'Holbrook, AZ', 'Winslow, AZ', 'Kingman, AZ', 'Williams, AZ', 'Tusayan, AZ',
  'Marble Canyon, AZ', 'Supai, AZ', 'Peach Springs, AZ', 'Fredonia, AZ', 'Fredonia, AZ',
].filter((v, i, a) => a.indexOf(v) === i).sort().slice(0, 500); // Remove duplicates, sort, limit to 500

/* ============================================================
   DESTINATION-SPECIFIC ACTIVITIES
   ============================================================ */

const DESTINATION_ACTIVITIES = {
  'Miami, FL': {
    restaurants: [
      { name: 'Juvia', price: '$$$', rating: 4.7, hours: '11:30am–midnight', distance: 2.1, description: 'Pan-Latin cuisine with rooftop views of Biscayne Bay and a vibrant atmosphere.', tip: 'Arrive before 8 PM for a quieter dining experience.' },
      { name: 'Casa Tua', price: '$$$', rating: 4.8, hours: '6pm–11pm', distance: 1.5, description: 'An intimate colonial mansion restaurant with farm-to-table Mediterranean fare.', tip: 'Book weeks ahead for weekend reservations. Dress code enforced.' },
      { name: 'García\'s Seafood Grille', price: '$$', rating: 4.5, hours: '10am–10pm', distance: 0.8, description: 'Fresh-caught seafood with views of Biscayne Bay and the fishing boats.', tip: 'The grouper sandwich is legendary. Come at sunset for the best views.' },
      { name: 'Ball & Turf Steakhouse', price: '$$$', rating: 4.6, hours: '5pm–11pm', distance: 3.2, description: 'Fine dining steakhouse with aged beef and an extensive wine selection.', tip: 'Happy hour 5–7 PM offers discounts on premium drinks.' },
    ],
    parks: [
      { name: 'Everglades National Park', price: '$$', rating: 4.8, hours: '6am–dusk', distance: 45, description: 'Vast subtropical wetlands teeming with alligators, manatees, and rare birds.', tip: 'Take an airboat tour—no better way to spot wildlife.' },
      { name: 'Wynwood Walls', price: '$', rating: 4.7, hours: 'Dawn–Dusk', distance: 4.3, description: 'An outdoor museum of vibrant street art and murals by world-class artists.', tip: 'Visit early morning for the best photos without crowds.' },
      { name: 'Key Biscayne National Park', price: '$$', rating: 4.6, hours: '7am–sunset', distance: 15, description: 'A pristine island refuge with white-sand beaches, coral reefs, and mangroves.', tip: 'Snorkel at shallow reef areas—bring your own gear or rent on-site.' },
      { name: 'Oleta River State Park', price: '$', rating: 4.5, hours: '8am–sunset', distance: 8, description: 'Mangrove forests with kayaking trails and hidden natural pools.', tip: 'Kayak rentals available. Bring insect repellent.' },
    ],
    museums: [
      { name: 'Pérez Art Museum Miami', price: '$$', rating: 4.7, hours: '10am–6pm', distance: 2.5, description: 'Contemporary art museum with an iconic design and waterfront location.', tip: 'Thursday evenings 6–9 PM are free for Miami residents.' },
      { name: 'Vizcaya Museum & Gardens', price: '$$', rating: 4.8, hours: '9:30am–4:30pm', distance: 3, description: 'A stunning 1916 Italian-villa mansion with lush formal gardens and bay views.', tip: 'Plan 2–3 hours to explore the grounds properly.' },
      { name: 'HistoryMiami', price: '$', rating: 4.4, hours: '10am–5pm', distance: 1.2, description: 'Exhibits on Miami\'s history from Biscayne Bay pirates to modern cultural movements.', tip: 'The Cuban Heritage Collection is exceptional.' },
      { name: 'Wynwood Walls Art District', price: 'Free', rating: 4.7, hours: 'Dawn–Dusk', distance: 4.3, description: 'Street art gallery featuring rotating murals and cultural installations.', tip: 'Free to walk; bring a camera.' },
    ],
    hotels: [
      { name: 'The Setai Miami Beach', price: '$$$', rating: 4.9, hours: '24/7', distance: 0.5, description: 'Ultra-luxury Asian-inspired resort with three pools, a spa, and private beach.', tip: 'Rooms come with butler service. Worth every penny for a special occasion.' },
      { name: 'Faena Hotel Miami Beach', price: '$$$', rating: 4.8, hours: '24/7', distance: 1.2, description: 'A theatrical beachfront palace with red velvet, gold accents, and world-class dining.', tip: 'The evening Teatro show (free for guests) is unforgettable.' },
      { name: 'Mondrian South Beach', price: '$$', rating: 4.6, hours: '24/7', distance: 0.8, description: 'Colorful modern design hotel with rooftop pool, art installations, and beachfront bars.', tip: 'The Sunset rooftop lounge has the best skyline views in South Beach.' },
      { name: 'SLS Brickell', price: '$$', rating: 4.5, hours: '24/7', distance: 2.1, description: 'Trendy downtown hotel with high-design rooms, rooftop pool, and Michelin-starred dining.', tip: 'Brickell offers walkability for dining and nightlife.' },
    ],
  },
  'Grand Canyon, AZ': {
    restaurants: [
      { name: 'Bright Angel Lodge Restaurant', price: '$$', rating: 4.5, hours: '7am–10pm', distance: 0, description: 'Historic lodge restaurant with views of the canyon and hearty Arizona-style fare.', tip: 'Arrive early; it\'s the only dining option inside the park with a view.' },
      { name: 'El Tovar Hotel Dining Room', price: '$$$', rating: 4.7, hours: '6:30am–9:30pm', distance: 0.1, description: 'Fine dining with floor-to-ceiling canyon views and Southwestern cuisine.', tip: 'Reserve weeks ahead for dinner. The sunset views are magical.' },
      { name: 'Canyon Village Marketplace', price: '$', rating: 4.2, hours: '7am–8pm', distance: 1.5, description: 'Casual quick-service food court with salads, sandwiches, and grab-and-go items.', tip: 'Great for fueling up before hiking. Prices are steep but reasonable for the location.' },
      { name: 'Grand Canyon North Rim Lodge', price: '$$', rating: 4.4, hours: '6:30am–9pm', distance: 125, description: 'Remote lodge dining with country cooking and sweeping northern vistas.', tip: 'Open May–October only. The drive is scenic but long.' },
    ],
    parks: [
      { name: 'South Rim Trail', price: '$', rating: 4.9, hours: '24/7', distance: 0, description: 'A paved 13-mile scenic trail with unobstructed canyon views and easy access.', tip: 'Walk the sunrise section before crowds arrive around 8 AM.' },
      { name: 'Bright Angel Trail', price: 'Free', rating: 4.8, hours: '24/7', distance: 0, description: 'The most popular trail, descending 4,380 feet with rest houses and water stations.', tip: 'Don\'t hike to the river and back in one day—it\'s brutal. Day hikers should stop at 3 Mile or Indian Garden.' },
      { name: 'Grand View Trail', price: 'Free', rating: 4.7, hours: 'Dawn–Dusk', distance: 0.5, description: 'A short 4-mile roundtrip walk with multiple overlooks and dramatic colored cliffs.', tip: 'The least crowded South Rim trail with equally stunning views.' },
      { name: 'Hermits Rest scenic Drive', price: '$', rating: 4.6, hours: '8am–sunset', distance: 7, description: 'A winding 7-mile road hugging the canyon edge with nine scenic pullouts and hiking trailheads.', tip: 'Shuttle-only access March–November. Sunset from Hopi Point is unreal.' },
    ],
    museums: [
      { name: 'Grand Canyon Visitor Center', price: 'Free', rating: 4.6, hours: '8am–5pm', distance: 1.2, description: 'Interactive exhibits on geology, history, and wildlife of the canyon.', tip: 'Pick up a detailed park map here and ask rangers for hidden gem recommendations.' },
      { name: 'South Rim Geology Museum', price: 'Included with park entry', rating: 4.5, hours: '9am–4pm', distance: 0.8, description: 'Rock specimens, maps, and exhibits explaining the 1.8-billion-year geological story.', tip: 'Spend 30 minutes here before hiking to better appreciate what you\'re seeing.' },
      { name: 'Verkamp\'s Curios Historic Building', price: 'Free', rating: 4.4, hours: '9am–5pm', distance: 0.2, description: 'A 130-year-old trading post-turned-museum with vintage curio collections and local history.', tip: 'The building itself is historic; grab postcards from the 1920s at the gift shop.' },
      { name: 'Tusayan Museum', price: '$', rating: 4.3, hours: '8am–4pm', distance: 22, description: 'A small museum dedicated to the Ancestral Puebloan people and local history.', tip: 'Call ahead; it closes seasonally.' },
    ],
    hotels: [
      { name: 'El Tovar Hotel', price: '$$$', rating: 4.8, hours: '24/7', distance: 0, description: 'Historic 1905 luxury lodge perched at the canyon rim with fireplaces and canyon suites.', tip: 'Book years ahead. Even standard rooms have incredible views.' },
      { name: 'Bright Angel Lodge', price: '$$', rating: 4.6, hours: '24/7', distance: 0.1, description: 'Historic, rustic lodge with cozy cabin-style rooms and a huge fireplace lounge.', tip: 'Rooms without a rim view are half the price but feel less special.' },
      { name: 'Kachina Lodge', price: '$$', rating: 4.4, hours: '24/7', distance: 0.5, description: 'Modern motel-style lodge nestled in ponderosa pines, steps from the rim trail.', tip: 'No views, but central location and quiet forest setting.' },
      { name: 'Yavapai Lodge', price: '$', rating: 4.2, hours: '24/7', distance: 2, description: 'Budget-friendly lodge with basic rooms and access to all park facilities.', tip: 'No frills, but comfortable and the best value in the park.' },
    ],
  },
  'New York City, NY': {
    restaurants: [
      { name: 'Balthazar', price: '$$$', rating: 4.8, hours: '11am–midnight', distance: 0.5, description: 'A Parisian-style brasserie in SoHo with exceptional French cuisine and a bustling bar scene.', tip: 'Reserve weeks ahead or eat at the bar for walk-ins. The steak frites are perfection.' },
      { name: 'Per Se', price: '$$$', rating: 4.9, hours: '5:30pm–9:30pm', distance: 2.1, description: 'Three-Michelin-star fine dining in Columbus Circle with nine-course tasting menus.', tip: 'Budget $350+ per person. Book months in advance.' },
      { name: 'Carbone', price: '$$', rating: 4.7, hours: '5pm–midnight', distance: 0.8, description: 'Trendy Italian-American spot in Greenwich Village with housemade pasta and roasted chicken.', tip: 'Walk-ins unlikely; reserve online. Arrives 5:30 PM or after 10 PM for a quieter experience.' },
      { name: 'Di Fara Pizza', price: '$', rating: 4.6, hours: '11am–9pm', distance: 8.2, description: 'Legendary Brooklyn pizza institution since 1959 with crispy crust and fresh toppings.', tip: 'Cash only. The margherita pizza is a must-try.' },
    ],
    parks: [
      { name: 'Central Park', price: 'Free', rating: 4.8, hours: '6am–1am', distance: 0, description: 'The iconic 843-acre urban park with lakes, forests, playgrounds, and cultural attractions.', tip: 'Walk the Reservoir Loop at sunrise for fewer crowds and gorgeous light.' },
      { name: 'High Line', price: 'Free', rating: 4.7, hours: '7am–11pm', distance: 1.5, description: 'A linear elevated park built on a historic freight rail line with gardens, art, and river views.', tip: 'Visit at sunset for the best light and fewer crowds.' },
      { name: 'Brooklyn Bridge Park', price: 'Free', rating: 4.8, hours: 'Down–Dusk', distance: 1.2, description: 'A waterfront park with Manhattan skyline views, gardens, and recreation areas.', tip: 'Bring a picnic and watch the sunset over the Statue of Liberty.' },
      { name: 'Hudson River Greenway', price: 'Free', rating: 4.6, hours: 'All hours', distance: 0.2, description: 'An 11-mile waterfront path for walking, running, and cycling with parks and piers.', tip: 'Bike the entire length for an easy, scenic 45-minute ride.' },
    ],
    museums: [
      { name: 'Metropolitan Museum of Art', price: '$$', rating: 4.9, hours: '10am–5:30pm', distance: 0.5, description: 'One of the world\'s greatest art museums with 1.5 million pieces spanning 5,000 years.', tip: 'Plan multiple visits. Focus on Egyptian Antiquities or American Art in a single trip.' },
      { name: 'American Museum of Natural History', price: '$$', rating: 4.8, hours: '10am–5:45pm', distance: 1.2, description: 'Iconic museum with dinosaur fossils, the blue whale, planetarium shows, and dioramas.', tip: 'Arrive at opening for shorter lines. The Hall of Ocean Life is mesmerizing.' },
      { name: 'Guggenheim Museum', price: '$$', rating: 4.7, hours: '10am–5:45pm', distance: 1.8, description: 'Frank Lloyd Wright\'s spiral masterpiece housing modern and contemporary art.', tip: 'Walk from the ground floor up—the architecture is part of the art.' },
      { name: 'Museum of Modern Art (MoMA)', price: '$$', rating: 4.8, hours: '10am–7pm', distance: 1.5, description: 'World-class modern and contemporary art in a renovated Midtown building.', tip: 'Friday evenings 4–7 PM offer a more relaxed vibe than afternoons.' },
    ],
    hotels: [
      { name: 'The Plaza Hotel', price: '$$$', rating: 4.8, hours: '24/7', distance: 0.1, description: 'The iconic 1907 Fifth Avenue palace overlooking Central Park with opulent rooms.', tip: 'The cheapest rooms still cost $300+. Afternoon tea in the lobby is a tradition.' },
      { name: 'The Peninsula New York', price: '$$$', rating: 4.8, hours: '24/7', distance: 0.5, description: 'Luxury Midtown hotel with a rooftop spa, haute cuisine, and impeccable service.', tip: 'The rooftop pool and lounge are free for hotel guests.' },
      { name: 'NoMad Hotel', price: '$$', rating: 4.7, hours: '24/7', distance: 0.3, description: 'Stylish boutique hotel in a historic building with an elegant bar and garden.', tip: 'The ground-floor restaurant is excellent but pricey.' },
      { name: 'The Jane Hotel', price: '$', rating: 4.4, hours: '24/7', distance: 2.1, description: 'Budget-friendly, quirky West Village hotel in a renovated 1908 building.', tip: 'Rooms are small but charming. Great value for NYC.' },
    ],
  },
  'Los Angeles, CA': {
    restaurants: [
      { name: 'Gwen', price: '$$$', rating: 4.8, hours: '5pm–10pm', distance: 2.1, description: 'Contemporary California cuisine from a James Beard award-winning chef in Downtown LA.', tip: 'The seasonal tasting menu is exceptional. Reserve well ahead.' },
      { name: 'Bestia', price: '$$', rating: 4.7, hours: '5pm–midnight', distance: 1.5, description: 'Roman-style antipasti, handmade pasta, and roasted meats in an intimate setting.', tip: 'Arrive early or very late; it\'s always packed. The burrata is legendary.' },
      { name: 'Nobu Malibu', price: '$$$', rating: 4.7, hours: '11:30am–3pm, 5:30pm–10pm', distance: 25, description: 'Iconic oceanfront Japanese-Peruvian fusion restaurant with stunning Pacific views.', tip: 'Reserve months ahead. Sunset dinner is unforgettable.' },
      { name: 'Gjelina', price: '$$', rating: 4.6, hours: '11am–11pm', distance: 10, description: 'Neighborhood favorite in Venice Beach serving organic farm-to-table California cuisine.', tip: 'No reservations; arrive before noon or after 9 PM.' },
    ],
    parks: [
      { name: 'Griffith Observatory', price: 'Free', rating: 4.8, hours: '12pm–10pm', distance: 8, description: 'Iconic observatory with stargazing, exhibits, and panoramic views of the LA skyline.', tip: 'Go at sunset; the views are spectacular and the crowds are lighter than evening hours.' },
      { name: 'Santa Monica Pier', price: '$', rating: 4.7, hours: 'All hours', distance: 12, description: 'Historic 1909 pier with an amusement park, arcade games, and ocean views.', tip: 'Sunset rides on the Ferris wheel are magical. Street performers are entertaining.' },
      { name: 'Runyon Canyon Park', price: 'Free', rating: 4.6, hours: '6:30am–10pm', distance: 3.5, description: 'Popular Hollywood hiking trail with Los Angeles skyline and celebrity home views.', tip: 'Go early morning to avoid crowds and heat. Bring water.' },
      { name: 'The Getty Center', price: 'Free', rating: 4.9, hours: '10am–5:30pm', distance: 5, description: 'World-class art museum on a hilltop with gardens, views, and free admission.', tip: 'Parking is $20; arrive before 11 AM to secure parking spots.' },
    ],
    museums: [
      { name: 'The Getty Center', price: 'Free', rating: 4.9, hours: '10am–5:30pm', distance: 5, description: 'Stunning hilltop museum with classical to contemporary art, gardens, and city views.', tip: 'Allot 3 hours minimum. The architecture is as important as the art.' },
      { name: 'LACMA', price: '$$', rating: 4.6, hours: '11am–8pm', distance: 6.2, description: 'Los Angeles County Museum of Art with extensive collections and the famous Urban Light installation.', tip: 'The Urban Light (24 vintage streetlamps) is perfect for photos at sunset.' },
      { name: 'Broad Museum', price: '$', rating: 4.7, hours: '10am–6pm', distance: 1.2, description: 'Contemporary art museum with a striking design featuring a 3,000-piece collection.', tip: 'Admission is free but reserve tickets online. The permanent collection is thoughtfully curated.' },
      { name: 'Natural History Museum', price: '$$', rating: 4.5, hours: '9:30am–5pm', distance: 1.5, description: 'Natural history museum with dinosaur fossils, gems, and mammals.', tip: 'The dinosaur hall is outstanding. Bring kids for a full afternoon.' },
    ],
    hotels: [
      { name: 'Hotel Bel-Air', price: '$$$', rating: 4.9, hours: '24/7', distance: 4.5, description: 'Legendary pink palace in the Hollywood Hills with lush gardens, swans, and elite clientele.', tip: 'Even the least expensive room is $500+, but it\'s worth it for the experience.' },
      { name: 'Chateau Marmont', price: '$$$', rating: 4.7, hours: '24/7', distance: 3.2, description: 'Hollywood icon built as a private castle replica with a storied history and rooftop pool.', tip: 'The rooftop views are unreal. Stay for the location and history, not necessarily the room amenities.' },
      { name: 'Soho House West Hollywood', price: '$$', rating: 4.6, hours: '24/7', distance: 2.8, description: 'Members\' club hotel with a vibrant scene, rooftop pool, and high-design rooms.', tip: 'Non-members can book—it\'s pricey but offers incredible networking opportunities.' },
      { name: 'Hotel Erwin', price: '$$', rating: 4.5, hours: '24/7', distance: 12, description: 'Beachfront Venice hotel with ocean views, rooftop pool, and walkable Venice Beach location.', tip: 'The beachfront rooms face the pier and ocean—request a high floor.' },
    ],
  },
  'Orlando, FL': {
    restaurants: [
      { name: 'Victoria & Albert\'s', price: '$$$', rating: 4.8, hours: '5:30pm–9:30pm', distance: 2.5, description: 'Fine dining in a historic Victorian mansion with seasonal tasting menus and wine pairings.', tip: 'The most romantic restaurant in Orlando. Book months ahead.' },
      { name: 'Jiko – Epcot Japanese Restaurant', price: '$$', rating: 4.7, hours: '5pm–9pm', distance: 5.2, description: 'Pan-Asian fusion in Epcot with Japanese, Korean, and American-influenced dishes.', tip: 'Park-hopper ticket required to visit Epcot. Sake pairings are excellent.' },
      { name: 'Rix Sportbar & Grill', price: '$$', rating: 4.6, hours: '11am–midnight', distance: 4.1, description: 'High-energy sports bar with Wagyu beef, craft cocktails, and game screens everywhere.', tip: 'Great for group dining before a night out.' },
      { name: 'Art Smith\'s Homecomin\'', price: '$$', rating: 4.5, hours: '11am–10pm', distance: 3, description: 'Southern-comfort-food restaurant by celebrity chef Art Smith with outdoor patio and giant tree.', tip: 'The fried chicken and biscuits are sensational. Arrive early or late for seating.' },
    ],
    parks: [
      { name: 'Walt Disney World', price: '$$$', rating: 4.9, hours: '8am–11pm', distance: 15, description: 'The most visited vacation resort on Earth with four theme parks, resorts, and attractions.', tip: 'Book hotels early. Mobile app for ride reservations is essential. Arrive at opening.' },
      { name: 'Universal Orlando Resort', price: '$$', rating: 4.8, hours: '9am–10pm', distance: 8, description: 'Two theme parks with thrill rides, Hogwarts, Marvel, and blockbuster entertainment.', tip: 'Express Pass saves hours in lines. Wizarding World of Harry Potter is a must.' },
      { name: 'SeaWorld Orlando', price: '$$', rating: 4.5, hours: '8am–10pm', distance: 12, description: 'Marine life park with shows, animal encounters, and water rides.', tip: 'Tickets often discounted online. Best for families with young children.' },
      { name: 'Kennedy Space Center', price: '$$', rating: 4.8, hours: '9am–6pm', distance: 45, description: 'NASA visitor center with rockets, astronaut encounters, and space shuttle Atlantis.', tip: 'Allow a full day. The astronaut meet-and-greets are unforgettable.' },
    ],
    museums: [
      { name: 'Epcot', price: '$$$', rating: 4.8, hours: '8am–10pm', distance: 5.2, description: 'Disney theme park celebrating innovation, technology, and world cultures in eleven pavilions.', tip: 'Epcot alone requires 2 days to enjoy. World Showcase dining is world-class.' },
      { name: 'Kennedy Space Center', price: '$$', rating: 4.8, hours: '9am–6pm', distance: 45, description: 'Official visitor center with Apollo artifacts, Atlantis shuttle, and astronaut experiences.', tip: 'The "Shuttle Atlantis" exhibit is jaw-dropping and incredibly moving.' },
      { name: 'Orlando Science Center', price: '$$', rating: 4.6, hours: '10am–5pm', distance: 5, description: 'Interactive science exhibits with a planetarium, OMNIMAX theater, and hands-on displays.', tip: 'Great for rainy days. The live animal shows are engaging.' },
      { name: 'WonderWorks', price: '$$', rating: 4.5, hours: '9am–11pm', distance: 10, description: 'Indoor amusement park with laser tag, ropes course, virtual reality, and arcade games.', tip: 'Unlimited-play passes offer great value for families.' },
    ],
    hotels: [
      { name: 'Grand Floridian Resort & Spa', price: '$$$', rating: 4.8, hours: '24/7', distance: 5, description: 'Iconic Disney monorail resort modeled after the Grand Hotel in St. Paul with Victorian elegance.', tip: 'The lobby grand piano performances and afternoon tea are magical.' },
      { name: 'Coronado Springs Resort', price: '$$', rating: 4.6, hours: '24/7', distance: 8, description: 'Spanish colonial-themed Disney resort with a beautiful lakefront location and convention facilities.', tip: 'Newly renovated with premium rooms. Great value for the Disney experience.' },
      { name: 'Loews Portofino Bay Hotel', price: '$$$', rating: 4.7, hours: '24/7', distance: 1, description: 'Italian village-themed resort at Universal with lazy river, pool bar, and Italian dining.', tip: 'Hotel guests get early theme park entry. Worth the premium.' },
      { name: 'Rosen Plaza Hotel', price: '$$', rating: 4.4, hours: '24/7', distance: 3, description: 'Convention hotel near the parks with spacious rooms and good value for families.', tip: 'Good non-Disney/Universal option. Free theme park shuttle.' },
    ],
  },
};

// Provide a fallback for destinations not in the detailed list
function getActivitiesForDestination(destination) {
  if (DESTINATION_ACTIVITIES[destination]) return DESTINATION_ACTIVITIES[destination];

  // Return a generic/default set for any unspecified destination
  return {
    restaurants: [
      { name: 'Local Bistro', price: '$$', rating: 4.5, hours: '11am–10pm', distance: 1.5, description: 'A charming neighborhood restaurant serving local favorites and comfort food.', tip: 'Ask the staff for hidden gem recommendations.' },
      { name: 'Farm-to-Table Eatery', price: '$$', rating: 4.6, hours: '5pm–10pm', distance: 2.0, description: 'Fresh ingredients sourced from local farms, prepared with seasonal flair.', tip: 'The seasonal menu changes monthly.' },
      { name: 'Global Fusion Kitchen', price: '$', rating: 4.4, hours: '10am–9pm', distance: 0.8, description: 'Casual spot blending international cuisines with innovative flavor combinations.', tip: 'Great for lunch. No reservations needed.' },
      { name: 'Fine Dining Gem', price: '$$$', rating: 4.7, hours: '6pm–10pm', distance: 3.2, description: 'Upscale restaurant with an exceptional wine list and creative tasting menus.', tip: 'Reserve in advance for special occasions.' },
    ],
    parks: [
      { name: 'City Central Park', price: 'Free', rating: 4.6, hours: 'Dawn–Dusk', distance: 1.2, description: 'An urban green space with walking trails, picnic areas, and scenic viewpoints.', tip: 'Sunrise walks are peaceful and beautiful.' },
      { name: 'Riverside Nature Preserve', price: 'Free', rating: 4.5, hours: '8am–Dusk', distance: 4.0, description: 'A natural habitat for local wildlife with kayaking and birding opportunities.', tip: 'Bring binoculars for bird watching.' },
      { name: 'Scenic Overlook Trail', price: '$', rating: 4.7, hours: 'Dawn–Dusk', distance: 2.5, description: 'A moderate hiking trail with panoramic views of the surrounding landscape.', tip: 'Best in early morning or late afternoon.' },
      { name: 'Downtown Plaza', price: 'Free', rating: 4.4, hours: 'All hours', distance: 0.5, description: 'A lively community gathering space with fountains, art, and seasonal events.', tip: 'Visit during evening events or farmers markets.' },
    ],
    museums: [
      { name: 'Local History Museum', price: '$', rating: 4.5, hours: '10am–5pm', distance: 1.0, description: 'A museum dedicated to the region\'s rich cultural and historical heritage.', tip: 'Often has special rotating exhibitions.' },
      { name: 'Art & Culture Gallery', price: '$', rating: 4.6, hours: '11am–6pm', distance: 1.8, description: 'Contemporary art gallery featuring local and regional artists.', tip: 'First Friday of the month is free entry.' },
      { name: 'Science Discovery Center', price: '$$', rating: 4.5, hours: '9am–5pm', distance: 2.2, description: 'Interactive exhibits exploring science, technology, and nature.', tip: 'Perfect for families. Planetarium shows run every two hours.' },
      { name: 'Heritage Cultural Center', price: '$', rating: 4.4, hours: '10am–4pm', distance: 1.5, description: 'A center celebrating the diverse cultures and traditions of the region.', tip: 'Guided tours available on weekends.' },
    ],
    hotels: [
      { name: 'Downtown Luxury Inn', price: '$$$', rating: 4.7, hours: '24/7', distance: 0.3, description: 'Upscale hotel in the heart of downtown with modern amenities and great service.', tip: 'The rooftop bar has excellent city views.' },
      { name: 'Riverside Resort Hotel', price: '$$', rating: 4.6, hours: '24/7', distance: 2.0, description: 'A charming waterfront hotel with scenic views and easy access to attractions.', tip: 'Request a room with river views.' },
      { name: 'Budget-Friendly Motor Lodge', price: '$', rating: 4.2, hours: '24/7', distance: 3.0, description: 'Comfortable, no-frills accommodation perfect for budget-conscious travelers.', tip: 'Good value and convenient location.' },
      { name: 'Boutique Inn & Suites', price: '$$', rating: 4.5, hours: '24/7', distance: 1.2, description: 'A stylish boutique hotel with personalized service and unique décor.', tip: 'Homemade breakfast included. Great for couples.' },
    ],
  };
}
