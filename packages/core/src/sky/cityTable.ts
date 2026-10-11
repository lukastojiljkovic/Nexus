/**
 * The shipped city table: every city on Earth with 100 000 people or more, by
 * name, country and coordinates — the list a reader picks a place from when the
 * computer's own zone is not the place they are in.
 *
 * **Source and licence.** GeoNames, `cities15000`
 * (https://download.geonames.org/export/dump/cities15000.zip), fetched
 * 2026-10-10, `cities15000.txt` from that archive. Licensed CC BY 4.0
 * (https://creativecommons.org/licenses/by/4.0/); the attribution the licence
 * asks for is: „Contains data from GeoNames (https://www.geonames.org/), licensed
 * under CC BY 4.0.“
 *
 * **The filter, and it is the whole of it.** Rows whose `population` column is
 * below 100 000 are dropped (GeoNames' own „15 000 or more“ dump, further
 * filtered to the hundred thousand the brief asks for); that leaves
 * 6 280 rows of the file's 34 156 — measured 2026-10-10. Nothing else is
 * filtered, renamed or corrected, so a reader comparing a row against GeoNames
 * finds the same name and the same coordinates.
 *
 * **Row format.** `Name|country|latDeg|lonDeg`, one per line, in POPULATION
 * order (largest first) so the file itself carries the ranking and
 * `cities.ts` owns the alphabetical one. Coordinates are rounded to two
 * decimal places, about 1.1 km, which is finer than the pin the map draws;
 * the source's own five are sub-metre and not that.
 *
 * **Why the encoding is safe to parse.** No name in this table contains `|`,
 * a backtick, a backslash, `${{`, a tab or an invisible character — all checked
 * when the table was generated and pinned by `cities.test.ts`, so a later
 * regeneration that broke the format fails a test rather than silently
 * truncating a name.
 */
export const CITY_TABLE = `Shanghai|CN|31.22|121.46
Chongqing|CN|29.56|106.56
Chengdu|CN|30.67|104.07
Beijing|CN|39.91|116.4
Guangzhou|CN|23.12|113.25
Shenzhen|CN|22.55|114.07
Kinshasa|CD|-4.33|15.31
Istanbul|TR|41.01|28.95
Lagos|NG|6.45|3.39
Ho Chi Minh City|VN|10.82|106.63
Tianjin|CN|39.14|117.18
Wuhan|CN|30.58|114.27
Lahore|PK|31.56|74.35
Xi’an|CN|34.26|108.93
Mumbai|IN|19.07|72.88
São Paulo|BR|-23.55|-46.64
Mexico City|MX|19.43|-99.13
Hangzhou|CN|30.29|120.16
Karachi|PK|24.86|67.01
Delhi|IN|28.65|77.23
Moscow|RU|55.75|37.62
Dhaka|BD|23.71|90.41
Seoul|KR|37.57|126.98
Harbin|CN|45.75|126.65
Tokyo|JP|35.69|139.69
Dongguan|CN|23.02|113.75
Cairo|EG|30.06|31.25
Hefei|CN|31.86|117.28
Johannesburg|ZA|-26.2|28.04
Weifang|CN|36.71|119.1
Nanjing|CN|32.06|118.78
Shenyang|CN|41.79|123.43
Foshan|CN|23.03|113.13
London|GB|51.51|-0.13
New York City|US|40.71|-74.01
Jakarta|ID|-6.21|106.85
Bengaluru|IN|12.97|77.59
Jinan|CN|36.67|117
Hanoi|VN|21.02|105.84
Taipei|TW|25.05|121.53
Lima|PE|-12.04|-77.03
Bogotá|CO|4.61|-74.08
Dalian|CN|38.91|121.6
Hong Kong|HK|22.28|114.17
Baghdad|IQ|33.34|44.4
Wuzhong|CN|37.99|106.2
Qingdao|CN|36.06|120.38
Tehran|IR|35.69|51.42
Yantai|CN|37.48|121.44
Hyderabad|IN|17.38|78.46
Rio de Janeiro|BR|-22.91|-43.18
Suzhou|CN|31.3|120.6
Puxi|CN|31.24|121.47
Zhengzhou|CN|34.76|113.65
Ahmedabad|IN|23.03|72.59
Abidjan|CI|5.35|-4
Nanning|CN|22.82|108.32
Kunming|CN|25.04|102.72
Shijiazhuang|CN|38.04|114.48
Changchun|CN|43.88|125.32
Pudong|CN|31.24|121.5
Sydney|AU|-33.87|151.21
Singapore|SG|1.29|103.85
Melbourne|AU|-37.81|144.96
Dar es Salaam|TZ|-6.82|39.27
Saint Petersburg|RU|59.94|30.31
Taiyuan|CN|37.87|112.56
Alexandria|EG|31.2|29.92
Bangkok|TH|13.75|100.5
Kano|NG|12|8.52
Santiago|CL|-33.46|-70.65
Cape Town|ZA|-33.93|18.42
Peshawar|PK|34.01|71.58
Zibo|CN|36.79|118.06
Jeddah|SA|21.49|39.19
Chennai|IN|13.09|80.28
Kolkata|IN|22.56|88.36
Xiamen|CN|24.48|118.08
Surat|IN|21.2|72.83
Yangzhou|CN|32.4|119.44
Huai'an|CN|33.59|119.02
Guiyang|CN|26.58|106.72
Yangon|MM|16.81|96.16
Bao'an|CN|22.55|113.88
Kabul|AF|34.53|69.17
Nairobi|KE|-1.28|36.82
Wuxi|CN|31.57|120.29
Giza|EG|30.01|31.21
Lanzhou|CN|36.06|103.84
Bamako|ML|12.61|-7.98
Riyadh|SA|24.69|46.72
Fuzhou|CN|26.06|119.31
Ürümqi|CN|43.8|87.6
New Taipei City|TW|25.06|121.46
New Territories|HK|22.42|114.11
Chattogram|BD|22.34|91.83
Addis Ababa|ET|9.02|38.75
Zaozhuang|CN|34.86|117.55
Zhongshan|CN|22.52|113.38
Shantou|CN|23.35|116.68
Los Angeles|US|34.05|-118.24
Faisalabad|PK|31.42|73.09
Dubai|AE|25.08|55.31
Yokohama|JP|35.43|139.65
Ningbo|CN|29.88|121.55
Nanhai|CN|23.02|113.14
Casablanca|MA|33.59|-7.61
Ibadan|NG|7.38|3.91
Puyang|CN|29.46|119.89
Ankara|TR|39.92|32.85
Shiyan|CN|32.65|110.78
Hohhot|CN|40.81|111.65
Berlin|DE|52.52|13.41
Tangshan|CN|39.64|118.18
Rawalpindi|PK|33.6|73.05
Lüliang|CN|37.52|111.14
Durban|ZA|-29.86|31.03
Anshan|CN|41.12|122.99
Changzhou|CN|31.77|119.95
Busan|KR|35.1|129.03
Madrid|ES|40.42|-3.7
Pyongyang|KP|39.03|125.75
Pune|IN|18.52|73.86
Datong|CN|40.09|113.29
Bursa|TR|40.2|29.06
Changsha|CN|28.2|112.97
Quezon City|PH|14.65|121.05
Jaipur|IN|26.92|75.79
Huainan|CN|32.63|117
Surabaya|ID|-7.25|112.75
Incheon|KR|37.46|126.71
Haikou|CN|20.03|110.35
Caracas|VE|10.49|-66.88
Kyiv|UA|50.45|30.52
İzmir|TR|38.41|27.14
Huizhou|CN|23.11|114.42
Buenos Aires|AR|-34.61|-58.38
Yinchuan|CN|38.47|106.27
Taichung|TW|24.15|120.68
Kanpur|IN|26.47|80.35
Toronto|CA|43.71|-79.4
Quito|EC|-0.23|-78.52
Brisbane|AU|-27.47|153.03
Luanda|AO|-8.84|13.23
Baotou|CN|40.65|109.84
Osaka|JP|34.69|135.5
Linyi|CN|35.06|118.34
Baoding|CN|38.87|115.46
Kaohsiung|TW|22.62|120.31
Brooklyn|US|40.65|-73.95
Guayaquil|EC|-2.2|-79.89
Belo Horizonte|BR|-19.92|-43.94
Minhang|CN|31.11|121.37
Bazhong|CN|31.87|106.74
Salvador|BR|-12.98|-38.49
Abuja|NG|9.06|7.5
Gazipur|BD|24|90.42
Chicago|US|41.85|-87.65
Wenzhou|CN|28|120.67
Bekasi|ID|-6.23|106.99
Dakar|SN|14.69|-17.44
Haiphong|VN|20.86|106.68
Yunfu|CN|22.93|112.04
Navi Mumbai|IN|19.04|73.02
Mogadishu|SO|2.04|45.34
Kumasi|GH|6.69|-1.62
Bandung|ID|-6.92|107.61
Gujranwala|PK|32.16|74.19
Medan|ID|3.58|98.67
Lucknow|IN|26.84|80.92
Xining|CN|36.63|101.76
Ouagadougou|BF|12.37|-1.53
Nagpur|IN|21.15|79.08
Fortaleza|BR|-3.72|-38.54
Cali|CO|3.43|-76.52
Perth|AU|-31.95|115.86
Daegu|KR|35.87|128.59
Algiers|DZ|36.73|3.09
Nanchang|CN|28.68|115.85
Baku|AZ|40.38|49.89
Nagoya|JP|35.18|136.91
Rome|IT|41.89|12.51
Queens|US|40.68|-73.84
Houston|US|29.76|-95.36
Mashhad|IR|36.3|59.61
Shaoxing|CN|30|120.58
Nantong|CN|32.03|120.87
Baoshan|CN|31.41|121.49
Kowloon|HK|22.32|114.18
Gaziantep|TR|37.06|37.38
Lubumbashi|CD|-11.66|27.48
Manaus|BR|-3.1|-60.02
Lusaka|ZM|-15.41|28.29
Brasília|BR|-15.78|-47.93
Zhuhai|CN|22.28|113.57
Santo Domingo|DO|18.47|-69.89
Lomé|TG|6.13|1.22
Multan|PK|30.2|71.48
Havana|CU|23.13|-82.38
Depok|ID|-6.4|106.82
Ordos|CN|39.61|109.78
Paris|FR|48.85|2.35
Coimbatore|IN|11.01|76.97
Qingyang|CN|35.71|107.64
Port Harcourt|NG|4.78|7.01
Pretoria|ZA|-25.74|28.19
Córdoba|AR|-31.41|-64.19
Mbuji-Mayi|CD|-6.14|23.59
Aleppo|SY|36.2|37.16
Kunshan|CN|31.38|120.95
Al Mawşil al Jadīdah|IQ|36.33|43.11
Zunyi|CN|27.69|106.91
La Paz|BO|-16.5|-68.15
Lianyungang|CN|34.6|119.22
Medellín|CO|6.25|-75.57
Puning|CN|23.31|116.17
Indore|IN|22.72|75.83
Brazzaville|CG|-4.27|15.28
Tashkent|UZ|41.26|69.22
Ganzhou|CN|25.85|114.93
Almaty|KZ|43.25|76.91
Khartoum|SD|15.55|32.53
Hamburg|DE|53.55|9.99
Sapporo|JP|43.07|141.35
Songjiang|CN|31.03|121.22
Accra|GH|5.56|-0.2
Curitiba|BR|-25.43|-49.27
Sanaa|YE|15.35|44.21
Conakry|GN|9.54|-13.68
Tangerang|ID|-6.18|106.63
Tijuana|MX|32.5|-117
Hyderabad|PK|25.4|68.38
Beirut|LB|33.89|35.5
Jieyang|CN|23.54|116.37
Jilin|CN|43.85|126.56
Jiading|CN|31.39|121.24
Bucharest|RO|44.43|26.11
Camayenne|GN|9.54|-13.69
Kakamega|KE|0.28|34.75
Shangqiu|CN|34.41|115.66
Nanchong|CN|30.8|106.08
Tainan|TW|22.99|120.21
Kaduna|NG|10.53|7.44
Omdurman|SD|15.64|32.48
Davao|PH|7.07|125.61
Thāne|IN|19.2|72.96
Iztapalapa|MX|19.36|-99.06
Diyarbakır|TR|37.91|40.22
Santa Cruz de la Sierra|BO|-17.79|-63.18
Vadodara|IN|22.3|73.21
Adana|TR|36.99|35.33
Nanyang|CN|33.01|112.55
Abu Dhabi|AE|24.45|54.4
Palembang|ID|-2.92|104.75
Sharjah|AE|25.33|55.41
Bhopal|IN|23.25|77.4
Jiangmen|CN|22.58|113.08
Benin City|NG|6.34|5.63
Jiangyin|CN|31.91|120.26
Fuyang|CN|32.9|115.82
Montréal|CA|45.51|-73.59
Bayan Nur|CN|40.74|107.39
Chengtangcun|CN|35.08|117.19
Maracaibo|VE|10.64|-71.61
Chaozhou|CN|23.65|116.62
Minsk|BY|53.9|27.57
Budapest|HU|47.5|19.04
Qingyuan|CN|23.7|113.03
Tai’an|CN|36.19|117.12
Rasapūdipalem|IN|17.73|83.32
Pimpri-Chinchwad|IN|18.62|73.8
Caloocan|PH|14.65|120.97
Warsaw|PL|52.23|21.01
Soweto|ZA|-26.27|27.86
Semarang|ID|-6.99|110.42
Puebla|MX|19.05|-98.21
Vienna|AT|48.21|16.37
Barcelona|ES|41.39|2.16
Patna|IN|25.59|85.14
Mosul|IQ|36.34|43.12
Kallakurichi|IN|11.73|78.96
Kampala|UG|0.32|32.58
Changshu|CN|31.65|120.74
Rabat|MA|34.01|-6.83
Recife|BR|-8.05|-34.88
Phoenix|US|33.45|-112.07
Suzhou|CN|33.64|116.98
Ecatepec de Morelos|MX|19.6|-99.06
Lu’an|CN|31.74|116.52
Valencia|VE|10.16|-68
Ludhiana|IN|30.91|75.85
Yancheng|CN|33.36|120.16
Novosibirsk|RU|55.02|82.93
Erbil|IQ|36.19|44.01
Fukuoka|JP|33.6|130.42
Taizhou|CN|32.49|119.91
Daqing|CN|46.58|125
Kisangani|CD|0.52|25.19
Manila|PH|14.6|120.98
Wuhu|CN|31.35|118.43
Santiago de Querétaro|MX|20.59|-100.39
Dazhou|CN|31.21|107.46
León de los Aldama|MX|21.12|-101.68
Makkah|SA|21.43|39.83
Philadelphia|US|39.95|-75.16
Phnom Penh|KH|11.56|104.92
Guilin|CN|25.28|110.3
Damascus|SY|33.51|36.29
Quetta|PK|30.18|67
Zhaoqing|CN|23.05|112.46
Onitsha|NG|6.15|6.79
Mianyang|CN|31.47|104.68
Auckland|NZ|-36.85|174.76
Isfahan|IR|32.65|51.67
Wanzhou|CN|30.76|108.4
Astana|KZ|51.18|71.45
Harare|ZW|-17.83|31.05
Monrovia|LR|6.3|-10.8
Putian|CN|25.44|119.01
Kawasaki|JP|35.52|139.72
Goiânia|BR|-16.68|-49.25
San Antonio|US|29.42|-98.49
Kobe|JP|34.69|135.18
Jinzhou|CN|41.11|121.14
Stockholm|SE|59.33|18.07
Ciudad Juárez|MX|31.72|-106.46
Cần Thơ|VN|10.04|105.79
Munich|DE|48.14|11.58
Khulna|BD|22.81|89.56
Belém|BR|-1.46|-48.5
Yekaterinburg|RU|56.86|60.62
Porto Alegre|BR|-30.03|-51.23
Manhattan|US|40.78|-73.97
Nashik|IN|20|73.79
Taizhou|CN|28.66|121.43
Asunción|PY|-25.29|-57.65
Yiwu|CN|29.32|120.08
Zapopan|MX|20.72|-103.39
Makassar|ID|-5.15|119.43
Adelaide|AU|-34.93|138.6
Quanzhou|CN|24.91|118.59
Madurai|IN|9.92|78.12
Jinhua|CN|29.11|119.64
Kyoto|JP|35.02|135.75
Cixi|CN|30.18|121.25
Changde|CN|29.03|111.7
Kuala Lumpur|MY|3.14|101.69
Kayseri|TR|38.73|35.49
Kaifeng|CN|34.8|114.31
Karaj|IR|35.83|50.99
Kathmandu|NP|27.7|85.32
Daejeon|KR|36.35|127.38
Baoji|CN|34.37|107.24
Suqian|CN|33.95|118.3
Liuzhou|CN|24.32|109.41
Tirunelveli|IN|8.73|77.68
Konya|TR|37.87|32.48
Zhangjiagang|CN|31.87|120.54
Agra|IN|27.18|78.02
South Tangerang|ID|-6.29|106.72
Tabriz|IR|38.08|46.29
Kharkiv|UA|49.98|36.25
Xinyang|CN|32.12|114.07
Jinjiang|CN|24.82|118.57
Faridabad|IN|28.41|77.31
Bozhou|CN|33.88|115.77
Qujing|CN|25.48|103.78
San Diego|US|32.72|-117.16
Gwangju|KR|35.15|126.92
Zhanjiang|CN|21.23|110.39
Fushun|CN|41.89|123.94
Rājkot|IN|22.29|70.79
Luoyang|CN|34.67|112.44
Guadalajara|MX|20.68|-103.35
The Bronx|US|40.85|-73.87
Guankou|CN|28.16|113.63
Huế|VN|16.46|107.6
Milan|IT|45.46|9.19
Najafgarh|IN|28.61|76.98
Lianjiang|CN|21.65|110.28
N'Djamena|TD|12.11|15.04
Handan|CN|36.61|114.49
Bannu|PK|32.99|70.6
Yichang|CN|30.71|111.28
Antananarivo|MG|-18.91|47.54
Heze|CN|35.24|115.47
Guarulhos|BR|-23.46|-46.53
Abobo|CI|5.42|-4.02
Jamshedpur|IN|22.8|86.19
Douala|CM|4.05|9.7
Antalya|TR|36.91|30.7
Basrah|IQ|30.51|47.78
Dallas|US|32.78|-96.81
Saitama|JP|35.91|139.66
Niamey|NE|13.51|2.11
Liupanshui|CN|26.59|104.83
Taguig|PH|14.52|121.08
Maoming|CN|21.67|110.91
Calgary|CA|51.05|-114.09
Tripoli|LY|32.89|13.19
Madinah|SA|24.47|39.61
Yaoundé|CM|3.87|11.52
Batam|ID|1.15|104.02
Qinzhou|CN|21.98|108.65
Luohe|CN|33.57|114.03
Xiangyang|CN|32.04|112.14
Yangjiang|CN|21.86|111.96
Yixing|CN|31.36|119.82
Pimpri|IN|18.62|73.81
Da Nang|VN|16.07|108.22
Amman|JO|31.96|35.95
Budta|PH|7.2|124.44
Belgrade|RS|44.8|20.47
Biên Hòa|VN|10.94|106.82
Kananga|CD|-5.9|22.42
Qingpu|CN|31.15|121.11
Montevideo|UY|-34.9|-56.19
Xuchang|CN|34.03|113.86
Kalyān|IN|19.24|73.14
Zigong|CN|29.34|104.78
Nizhniy Novgorod|RU|56.33|44
Jepara|ID|-6.59|110.67
Maputo|MZ|-25.97|32.58
Xuzhou|CN|34.2|117.28
Dammam|SA|26.43|50.1
Ra’s Bayrūt|LB|33.9|35.48
Neijiang|CN|29.58|105.06
Shiraz|IR|29.61|52.53
Heshan|CN|28.57|112.35
Dombivali|IN|19.22|73.08
Kazan|RU|55.79|49.12
Jining|CN|35.41|116.58
Barquisimeto|VE|10.06|-69.36
Shubrā al Khaymah|EG|30.13|31.25
Putuo|CN|31.25|121.39
Port-au-Prince|HT|18.54|-72.34
Suwon|KR|37.29|127.01
Liaocheng|CN|36.45|116
Jinzhong|CN|37.68|112.75
Callao|PE|-12.05|-77.13
Meerut|IN|28.98|77.71
Virār|IN|19.46|72.81
Nowrangapur|IN|19.23|82.55
Karbala|IQ|32.62|44.02
Changzhi|CN|36.18|113.11
Tianshui|CN|34.58|105.74
Sadr City|IQ|33.39|44.46
Yangpu|CN|31.26|121.52
Mombasa|KE|-4.05|39.66
Mandalay|MM|21.97|96.08
Srinagar|IN|34.09|74.81
Barranquilla|CO|10.97|-74.78
Chelyabinsk|RU|55.16|61.43
Mérida|MX|20.97|-89.62
Hiroshima|JP|34.4|132.45
Santiago de los Caballeros|DO|19.45|-70.69
Shymkent|KZ|42.31|69.6
Weinan|CN|34.5|109.51
Ghāziābād|IN|28.67|77.44
Matola|MZ|-25.96|32.46
Dhanbad|IN|23.8|86.43
Arequipa|PE|-16.4|-71.54
Hong Kong Island|HK|22.26|114.18
Fes|MA|34.03|-5
Gustavo Adolfo Madero|MX|19.49|-99.11
Nouakchott|MR|18.09|-15.98
Jiaxing|CN|30.75|120.75
Aurangabad|IN|19.88|75.34
Zhongwei|CN|37.51|105.19
Omsk|RU|54.99|73.37
Pikine|SN|14.76|-17.39
Pekanbaru|ID|0.52|101.44
Panjin|CN|41.12|122.07
Bandar Lampung|ID|-5.43|105.26
Prague|CZ|50.09|14.42
Varanasi|IN|25.32|83.01
Jiujiang|CN|29.7|116
Samara|RU|53.21|50.14
Aba|NG|5.11|7.37
Amritsar|IN|31.62|74.88
Birmingham|GB|52.48|-1.9
Copenhagen|DK|55.68|12.57
Sofia|BG|42.7|23.32
Anyang|CN|36.1|114.38
Yerevan|AM|40.18|44.51
Luohu District|CN|22.55|114.13
Vijayawada|IN|16.51|80.65
Fengxiang|CN|30.86|121.47
Bijie|CN|27.3|105.29
Monterrey|MX|25.68|-100.32
Kigali|RW|-1.95|30.06
Rostov-on-Don|RU|47.22|39.71
Zhuzhou|CN|27.83|113.15
Rui’an|CN|27.78|120.66
Malingao|PH|7.16|124.48
Touba|SN|14.86|-15.88
Ufa|RU|54.74|55.97
Ranchi|IN|23.34|85.31
Zoucheng|CN|35.4|116.97
Shangrao|CN|28.45|117.94
Lilongwe|MW|-13.97|33.79
Huaibei|CN|33.97|116.79
Maiduguri|NG|11.85|13.16
Xuhui|CN|31.2|121.45
Meishan|CN|30.04|103.84
Mwanza|TZ|-2.52|32.9
Wuchang|CN|30.54|114.3
Ulsan|KR|35.54|129.32
Sendai|JP|38.27|140.87
Krasnoyarsk|RU|56.04|92.93
Fuzhou|CN|27.96|116.33
Guigang|CN|23.12|109.59
Oslo|NO|59.91|10.75
Jabalpur|IN|23.17|79.95
Ilorin|NG|8.5|4.54
Aden|YE|12.78|45.04
Bogor|ID|-6.59|106.79
Ciudad Nezahualcoyotl|MX|19.4|-99.01
Hengyang|CN|26.89|112.62
Prayagraj|IN|25.44|81.84
Trujillo|PE|-8.12|-79.03
Visakhapatnam|IN|17.68|83.2
Goyang-si|KR|37.66|126.84
Yulin|CN|22.63|110.15
Jodhpur|IN|26.27|73.01
Gwalior|IN|26.23|78.17
Jingzhou|CN|30.35|112.19
Gqeberha|ZA|-33.96|25.61
Tbilisi|GE|41.69|44.83
Voronezh|RU|51.67|39.19
Xinxiang|CN|35.19|113.8
Yichun|CN|27.83|114.4
Sokoto|NG|13.06|5.24
Jos|NG|9.93|8.89
Tangier|MA|35.77|-5.8
Teni|IN|10.01|77.48
Xianyang|CN|34.34|108.7
Mexicali|MX|32.63|-115.45
Pointe-Noire|CG|-4.78|11.86
Maceió|BR|-9.67|-35.74
Campinas|BR|-22.91|-47.06
Sanya|CN|18.25|109.51
Rangpur|BD|25.75|89.25
Kirkuk|IQ|35.47|44.39
Ashgabat|TM|37.95|58.38
Shaoguan|CN|24.8|113.58
Howrah|IN|22.58|88.32
Raipur|IN|21.23|81.63
Changwon|KR|35.23|128.68
Longyan|CN|25.07|117.02
Köln|DE|50.93|6.95
Dublin|IE|53.33|-6.25
Tiruchirappalli|IN|10.82|78.7
Yongzhou|CN|26.42|111.61
Brussels|BE|50.85|4.35
Zamboanga|PH|6.91|122.07
Ottawa|CA|45.41|-75.7
Huzhou|CN|30.87|120.09
Xinyi|CN|22.37|110.95
Volgograd|RU|48.71|44.5
Khartoum North|SD|15.65|32.53
Edmonton|CA|53.55|-113.47
Odesa|UA|46.49|30.74
Wuwei|CN|37.93|102.63
Jacksonville|US|30.33|-81.66
Fort Worth|US|32.73|-97.32
Yishui|CN|35.78|118.63
Hanzhong|CN|33.08|107.02
Hezhou|CN|24.4|111.57
Pest|HU|47.5|19.08
Kota|IN|25.18|75.84
Zhu Cheng City|CN|36|119.4
Shivaji Nagar|IN|18.53|73.85
Dongying|CN|37.46|118.49
Luzhou|CN|28.89|105.43
San Jose|US|37.34|-121.89
Sholapur|IN|17.67|75.91
Marrakesh|MA|31.63|-8
Guatemala City|GT|14.64|-90.51
Meizhou|CN|24.29|116.12
Yueyang|CN|29.37|113.09
Laiwu|CN|36.19|117.66
Esenyurt|TR|41.03|28.68
Perm|RU|58.01|56.25
Zaria|NG|11.11|7.72
Kennedy|CO|4.62|-74.15
Chiba|JP|35.6|140.12
Pingdingshan|CN|33.73|113.32
Ciudad Guayana|VE|8.35|-62.64
Sargodha|PK|32.09|72.67
Austin|US|30.27|-97.74
Managua|NI|12.13|-86.25
Bengbu|CN|32.94|117.36
Salé|MA|34.05|-6.8
Jerusalem|IL|31.77|35.22
Chandigarh|IN|30.74|76.79
Dnipro|UA|48.47|35.04
Feicheng|CN|36.25|116.77
Cebu City|PH|10.32|123.89
Sanhe|CN|39.98|117.07
Guli|CN|28.88|120.03
Tiruppur|IN|11.12|77.35
Guwahati|IN|26.18|91.75
Xiangtan|CN|27.85|112.9
Linfen|CN|36.09|111.52
Victoria|HK|22.29|114.14
Zhenjiang|CN|32.21|119.46
Enugu|NG|6.44|7.5
Rosario|AR|-32.95|-60.64
Sulţānah|SA|24.49|39.59
Huludao|CN|40.75|120.84
Hubballi|IN|15.35|75.13
Padang|ID|-0.95|100.35
Kitakyushu|JP|33.85|130.85
Taiz|YE|13.58|44.02
Setagaya|JP|35.64|139.65
Kingston|JM|18|-76.79
Jing’an|CN|31.22|121.42
Baoshan|CN|25.12|99.16
Chihuahua|MX|28.64|-106.09
Nay Pyi Taw|MM|19.75|96.13
Eskişehir|TR|39.78|30.52
Mysuru|IN|12.3|76.64
Chengde|CN|40.95|117.96
Salem|IN|11.65|78.16
São Luís|BR|-2.53|-44.3
Seongnam-si|KR|37.44|127.14
Cartagena|CO|10.4|-75.49
Antipolo|PH|14.63|121.12
Columbus|US|39.96|-83
Sialkot|PK|32.49|74.53
Charlotte|US|35.23|-80.84
Laibin|CN|23.75|109.22
Warri|NG|5.52|5.75
Naples|IT|40.85|14.27
Xiaogan|CN|30.93|113.92
Wuchuan|CN|21.46|110.77
Campo Grande|BR|-20.44|-54.65
Ziyang|CN|30.12|104.65
Bobo-Dioulasso|BF|11.18|-4.29
Bahawalpur|PK|29.4|71.68
Quzhou|CN|28.96|118.87
Blantyre|MW|-15.78|35.01
Donetsk|UA|48.02|37.8
Abū Ghurayb|IQ|33.31|44.18
Qom|IR|34.64|50.88
Bishkek|KG|42.87|74.59
Krasnodar|RU|45.05|38.98
Natal|BR|-5.79|-35.21
Pingxiang|CN|27.62|113.85
Malang|ID|-7.98|112.63
Cancún|MX|21.17|-86.85
Indianapolis|US|39.77|-86.16
Gurugram|IN|28.46|77.03
Bhubaneswar|IN|20.27|85.83
Zhoushan|CN|29.99|122.2
Qiqihar|CN|47.34|123.96
Mulenvos|AO|-8.87|13.33
Sulaymaniyah|IQ|35.56|45.43
Marseille|FR|43.3|5.38
Bhiwandi|IN|19.3|73.06
Soshanguve|ZA|-25.47|28.1
Laiyang|CN|36.98|120.71
Daye|CN|30.08|114.95
Teresina|BR|-5.09|-42.8
Ankang|CN|32.68|109.02
Jalandhar|IN|31.33|75.58
Rotterdam|NL|51.92|4.48
Langfang|CN|39.52|116.71
Lhasa|CN|29.65|91.1
Duque de Caxias|BR|-22.79|-43.31
Viana|AO|-8.91|13.37
Jiaozuo|CN|35.24|113.24
Samarinda|ID|-0.49|117.15
Benxi|CN|41.29|123.77
Rohini|IN|28.74|77.07
Wanxian|CN|30.82|108.37
Guang’an|CN|30.47|106.64
Johor Bahru|MY|1.47|103.76
Arifwala|PK|30.29|73.07
Pasig City|PH|14.59|121.06
Cheongju-si|KR|36.64|127.49
Kanayannur|IN|9.97|76.27
Tegucigalpa|HN|14.08|-87.21
Bucheon-si|KR|37.5|126.78
Thanh Hóa|VN|19.8|105.77
Turin|IT|45.07|7.69
Al Ain City|AE|24.19|55.76
Libreville|GA|0.39|9.45
Saratov|RU|51.54|45.99
Ulan Bator|MN|47.91|106.88
Weihai|CN|37.51|122.11
Takeo|KH|10.99|104.78
Nova Iguaçu|BR|-22.76|-43.45
Cochabamba|BO|-17.38|-66.16
Ahvaz|IR|31.32|48.68
Vientiane|LA|17.97|102.6
São Bernardo do Campo|BR|-23.69|-46.56
Zhabei|CN|31.26|121.46
Shangyu|CN|30.02|120.87
Xinyu|CN|27.8|114.93
Pietermaritzburg|ZA|-29.62|30.39
Yibin|CN|28.76|104.64
Naucalpan de Juárez|MX|19.48|-99.24
Kampung Baru Subang|MY|3.15|101.53
Bouaké|CI|7.69|-5.03
Taicang|CN|31.45|121.09
San Francisco|US|37.77|-122.42
Sakai|JP|34.58|135.47
Jiaojiang|CN|28.7|121.47
Valencia|ES|39.47|-0.38
Jinshan|CN|30.84|121.29
Chenzhou|CN|25.8|113.03
João Pessoa|BR|-7.11|-34.86
Bukavu|CD|-2.49|28.84
Kraków|PL|50.06|19.94
Dandong|CN|40.13|124.39
Barcelona|VE|10.14|-64.69
Bangui|CF|4.36|18.55
Hermosillo|MX|29.09|-110.97
Bhayandar|IN|19.3|72.85
Culiacán|MX|24.8|-107.39
Petaling Jaya|MY|3.11|101.61
Anqing|CN|30.51|117.05
Oran|DZ|35.7|-0.64
Freetown|SL|8.49|-13.24
San Pedro Sula|HN|15.51|-88.03
Narela|IN|28.85|77.09
Xingtai|CN|37.06|114.49
Niigata|JP|37.92|139.04
Muscat|OM|23.58|58.41
Zarqa|JO|32.07|36.09
Çankaya|TR|39.92|32.86
Küçükçekmece|TR|40.99|28.77
Hamamatsu|JP|34.7|137.73
Kolwezi|CD|-10.71|25.47
Vinh|VN|18.67|105.69
Thiruvananthapuram|IN|8.49|76.95
Zhaotong|CN|27.32|103.72
Hondlon|CN|40.65|109.79
Panzhihua|CN|26.59|101.71
Chuzhou|CN|32.32|118.3
Seattle|US|47.61|-122.33
Port Said|EG|31.27|32.3
Cúcuta|CO|7.91|-72.5
Homs|SY|34.72|36.73
Xuancheng|CN|30.95|118.76
Ibb|YE|13.97|44.18
Tasikmalaya|ID|-7.33|108.22
Nampula|MZ|-15.12|39.27
Bujumbura|BI|-3.38|29.36
Tyumen|RU|57.15|65.53
Erzurum|TR|39.91|41.28
Anshun|CN|26.25|105.93
Dodoma|TZ|-6.17|35.74
Rajshahi|BD|24.37|88.6
Dera Ismail Khan|PK|31.83|70.9
Sorocaba|BR|-23.5|-47.46
Wuzhou|CN|23.48|111.29
Ipoh|MY|4.58|101.08
Qinhuangdao|CN|39.94|119.59
Benghazi|LY|32.11|20.07
Uberlândia|BR|-18.92|-48.28
Alīgarh|IN|27.88|78.07
Shaoyang|CN|27.24|111.46
Malatya|TR|38.35|38.32
Winnipeg|CA|49.88|-97.15
Ōta|JP|35.56|139.72
Andijon|UZ|40.78|72.35
Bareilly|IN|28.37|79.43
Buraydah|SA|26.33|43.97
Hegang|CN|47.35|130.29
Morelia|MX|19.7|-101.18
Riga|LV|56.95|24.11
Zhuanghe|CN|39.7|122.99
Amsterdam|NL|52.37|4.89
Cagayan de Oro|PH|8.48|124.65
Ma’anshan|CN|31.69|118.51
Shah Alam|MY|3.09|101.53
Bağcılar|TR|41.04|28.86
Shizuishan|CN|38.98|106.39
Kumamoto|JP|32.81|130.69
Oyo|NG|7.85|3.93
Serang|ID|-6.12|106.15
Torreón|MX|25.54|-103.42
Deyang|CN|31.13|104.38
Abeokuta|NG|7.16|3.35
Al Ḩudaydah|YE|14.8|42.95
Yangquan|CN|37.86|113.56
Akure|NG|7.25|5.19
Denver|US|39.74|-104.98
Osasco|BR|-23.53|-46.79
Kikolo|AO|-8.78|13.33
Maianga|AO|-8.85|13.24
São José dos Campos|BR|-23.18|-45.89
Álvaro Obregón|MX|19.36|-99.2
Aihara|JP|35.6|139.32
Evaton|ZA|-26.53|27.85
Valenzuela|PH|14.7|120.97
Muzaffarābād|PK|34.37|73.47
Okayama|JP|34.65|133.93
San Luis Potosí|MX|22.15|-100.97
Aguascalientes|MX|21.88|-102.28
General Santos|PH|6.11|125.17
Zhumadian|CN|32.98|114.03
Morādābād|IN|28.84|78.78
Sagamihara|JP|35.57|139.24
Qingshan|CN|40.66|109.88
Mississauga|CA|43.58|-79.66
Lviv|UA|49.84|24.02
Namangan|UZ|41|71.67
Zaporizhzhya|UA|47.85|35.12
Zanzibar|TZ|-6.16|39.2
Saltillo|MX|25.43|-100.98
Latakia|SY|35.53|35.79
Subang Jaya|MY|3.04|101.58
Warangal|IN|18|79.58
Paranaque City|PH|14.48|121.02
Tolyatti|RU|53.53|49.35
Santo Domingo Oeste|DO|18.5|-70
Santo Domingo Este|DO|18.49|-69.85
Dhārāvi|IN|19.05|72.87
Battagram|PK|34.68|73.02
Suez|EG|29.97|32.53
Changzhi|CN|35.21|111.74
Ribeirão Preto|BR|-21.18|-47.81
Agadir|MA|30.42|-9.6
Edogawe|JP|35.69|139.87
Sarajevo|BA|43.85|18.36
Balikpapan|ID|-1.27|116.83
Adachi|JP|35.76|139.81
Changning|CN|31.22|121.42
Bauchi|NG|10.31|9.84
Shizuoka|JP|34.98|138.38
Tunis|TN|36.82|10.17
Zhangjiakou|CN|40.78|114.87
Washington|US|38.9|-77.04
Nashville|US|36.17|-86.78
Fuxin|CN|42.02|121.66
Ta’if|SA|21.27|40.42
Changsha|CN|22.38|112.68
Huangshi|CN|30.25|115.05
Liaoyang|CN|41.27|123.17
Hlaingthaya|MM|16.85|96.07
Beira|MZ|-19.84|34.84
Hongkou|CN|31.25|121.49
Zaragoza|ES|41.66|-0.88
Sevilla|ES|37.38|-5.97
Baise|CN|23.89|106.63
Pontianak|ID|-0.03|109.33
Situbondo|ID|-7.71|114.01
Agege|NG|6.62|3.33
Binzhou|CN|37.37|118.02
Oklahoma City|US|35.47|-97.52
Yuncheng|CN|35.02|110.99
Dezhou|CN|37.45|116.37
Dushanbe|TJ|38.54|68.78
Cotonou|BJ|6.37|2.42
El Paso|US|31.76|-106.49
Gorakhpur|IN|26.77|83.37
Guadalupe|MX|25.68|-100.26
Wrocław|PL|51.1|17.03
Denpasar|ID|-8.65|115.22
Guntur|IN|16.3|80.46
Katsina|NG|12.99|7.6
Sanmenxia|CN|34.78|111.19
E’zhou|CN|30.4|114.89
Madīnat an Naşr|EG|30.07|31.3
Camama|AO|-8.94|13.27
Tabuk|SA|28.4|36.57
Kitwe|ZM|-12.8|28.21
Bulawayo|ZW|-20.15|28.58
Mudanjiang|CN|44.55|129.63
Aracaju|BR|-10.91|-37.07
Joinville|BR|-26.3|-48.85
Athens|GR|37.98|23.73
Zagreb|HR|45.81|15.98
Leshan|CN|29.56|103.76
Santo André|BR|-23.66|-46.54
Vancouver|CA|49.25|-123.12
Rizhao|CN|35.41|119.53
Helsinki|FI|60.17|24.94
Cheonan|KR|36.81|127.15
Acapulco de Juárez|MX|16.85|-99.91
Dongcun|CN|36.78|121.16
Banjarmasin|ID|-3.32|114.59
Puducherry|IN|11.93|79.83
Suining|CN|30.51|105.57
Brampton|CA|43.68|-79.77
Huangpu|CN|31.24|121.48
Golfe|AO|-8.87|13.26
Puyang|CN|35.76|115.04
Soacha|CO|4.58|-74.22
Boston|US|42.36|-71.06
Tlalnepantla|MX|19.54|-99.2
Jājmau|IN|26.43|80.41
Portland|US|45.52|-122.68
Calumbo|AO|-9.15|13.42
Tlaquepaque|MX|20.64|-103.29
Frankfurt am Main|DE|50.12|8.68
Macau|MO|22.2|113.55
Palermo|IT|38.12|13.36
Izhevsk|RU|56.85|53.2
Colombo|LK|6.94|79.85
Maturín|VE|9.75|-63.18
Amravati|IN|20.93|77.75
Lingyuan|CN|41.24|119.4
Detroit|US|42.33|-83.05
Mingguang|CN|32.78|117.96
Osogbo|NG|7.77|4.56
Honchō|JP|35.7|139.99
Bikaner|IN|28.02|73.31
Jaboatão dos Guararapes|BR|-8.11|-35.01
Hoji ya Henda|AO|-8.81|13.29
Las Vegas|US|36.17|-115.14
New South Memphis|US|35.09|-90.06
Hwaseong-si|KR|37.21|126.82
Gold Coast|AU|-28|153.43
Łódź|PL|51.77|19.47
Jeonju|KR|35.82|127.15
Chongming|CN|31.62|121.7
Al Aḩmadī|KW|29.08|48.08
Cuenca|EC|-2.9|-79
Chisinau|MD|47.01|28.86
Likasi|CD|-10.98|26.74
Jambi City|ID|-1.6|103.62
Hebi|CN|35.73|114.29
Comilla|BD|23.46|91.19
Tshikapa|CD|-6.42|20.8
Chunian|PK|30.97|73.98
Kochi|IN|9.94|76.26
Memphis|US|35.15|-90.05
Jingmen|CN|31.03|112.2
Barnaul|RU|53.36|83.73
Piura|PE|-5.18|-80.66
Siping|CN|43.16|124.38
Bhilai|IN|21.21|81.43
Ndola|ZM|-12.96|28.64
Contagem|BR|-19.93|-44.05
Ulyanovsk|RU|54.33|48.39
Djibouti|DJ|11.59|43.15
Glasgow|GB|55.87|-4.26
Panshan|CN|41.19|122.05
Louisville|US|38.25|-85.76
Irkutsk|RU|52.3|104.29
Ansan-si|KR|37.32|126.82
Al Mansurah|EG|31.04|31.38
Kermanshah|IR|34.31|47.07
Jiaozhou|CN|36.28|120
Düsseldorf|DE|51.22|6.78
Suizhou|CN|31.71|113.36
Villa Nueva|GT|14.53|-90.59
Khabarovsk|RU|48.46|135.1
Cuiabá|BR|-15.6|-56.1
Arusha|TZ|-3.37|36.68
Feira de Santana|BR|-12.27|-38.97
Las Piñas|PH|14.45|120.98
Chizhou|CN|30.66|117.48
Coyoacán|MX|19.35|-99.16
Stuttgart|DE|48.78|9.18
Ya'an|CN|29.99|103
Cuttack|IN|20.46|85.88
Borivli|IN|19.23|72.86
Chiclayo|PE|-6.77|-79.85
Yaroslavl|RU|57.63|39.87
Gothenburg|SE|57.71|11.97
Kawaguchi|JP|35.81|139.71
Bukit Rahman Putra|MY|3.22|101.56
Jhang Sadr|PK|31.27|72.32
Ha'il|SA|27.52|41.69
Bhavnagar|IN|21.76|72.15
Benoni|ZA|-26.19|28.32
Vladivostok|RU|43.11|131.87
Tuxtla|MX|16.75|-93.12
Kryvyy Rih|UA|47.91|33.39
Sanming|CN|26.25|117.62
Islamabad|PK|33.72|73.04
Sāngli|IN|16.85|74.56
Jamnagar|IN|22.47|70.07
Lubango|AO|-14.92|13.49
Pokhara|NP|28.27|83.97
Shuangyashan|CN|46.68|131.13
Borama|SO|9.94|43.18
Pallabi|BD|23.83|90.37
Luancheng|CN|37.88|114.65
Makhachkala|RU|42.98|47.5
Anyang-si|KR|37.39|126.93
Huambo|AO|-12.78|15.74
Samarkand|UZ|39.65|66.96
Mengzi|CN|23.37|103.38
Kagoshima|JP|31.57|130.55
Mukalla|YE|14.54|49.12
Rasht|IR|37.28|49.59
Mar del Plata|AR|-38|-57.56
Essen|DE|51.46|7.01
Al Maḩallah al Kubrá|EG|30.97|31.17
Málaga|ES|36.72|-4.42
Shekhupura|PK|31.71|73.99
Yingkou|CN|40.66|122.23
Zhangzhou|CN|24.51|117.66
Reynosa|MX|26.08|-98.28
Thuận An|VN|10.92|106.71
Dortmund|DE|51.51|7.47
Suginami|JP|36.2|140.28
Baltimore|US|39.29|-76.61
Itabashi|JP|35.75|139.71
New Kingston|JM|18.01|-76.78
Pelentong|MY|1.52|103.82
Cimahi|ID|-6.87|107.54
Londrina|BR|-23.31|-51.16
Bucaramanga|CO|7.13|-73.12
Genoa|IT|44.4|8.94
Hachiōji|JP|35.66|139.32
Malacca|MY|2.2|102.24
Nha Trang|VN|12.25|109.19
Kerman|IR|30.28|57.08
Orūmīyeh|IR|37.55|45.08
Bahçelievler|TR|41|28.86
Tanta|EG|30.79|31
Jammu|IN|32.74|74.86
Iskandar Puteri|MY|1.39|103.62
Calamba|PH|14.21|121.17
Tlalpan|MX|19.3|-99.16
Herāt|AF|34.35|62.2
Dongsheng|CN|39.82|109.98
Gujrat|PK|32.57|74.08
Tomsk|RU|56.5|84.98
Ümraniye|TR|41.02|29.12
Shihezi|CN|44.3|86.04
South Boston|US|42.33|-71.05
Nakuru|KE|-0.31|36.07
Hamilton|CA|43.25|-79.85
Irbid|JO|32.56|35.85
Manchester|GB|53.48|-2.24
Kota Bharu|MY|6.12|102.24
Surrey|CA|49.11|-122.83
Meknes|MA|33.89|-5.55
Puente Alto|CL|-33.61|-70.58
Nyala|SD|12.05|24.88
Xinmin|CN|41.99|122.83
Dresden|DE|51.05|13.74
Orenburg|RU|51.77|55.1
Albuquerque|US|35.08|-106.65
Bokāro|IN|23.67|86.15
Asmara|ER|15.34|38.93
Sukkur|PK|27.7|68.86
Milwaukee|US|43.04|-87.91
Chợ Lớn|VN|10.75|106.66
Wenchang|CN|19.55|110.8
Ile-Ife|NG|7.48|4.56
Gombe|NG|10.29|11.17
Hamhŭng|KP|39.92|127.54
Kemerovo|RU|55.35|86.1
Nasiriyah|IQ|31.06|46.26
Bloemfontein|ZA|-29.12|26.21
Sheffield|GB|53.38|-1.47
Santiago de Cuba|CU|20.02|-75.82
Cuautitlán Izcalli|MX|19.64|-99.22
Benguela|AO|-12.58|13.4
Chuxiong|CN|25.04|101.55
Balbala|DJ|11.56|43.11
Huaihua|CN|27.56|110
Sishui|CN|35.65|117.28
Muntinlupa|PH|14.39|121.05
Bình Thạnh|VN|10.81|106.71
Zahedan|IR|29.5|60.86
Banqiao|TW|25.01|121.47
Nanded|IN|19.16|77.31
Kozhikode|IN|11.25|75.78
Ulanqab|CN|40.99|113.13
Cabinda|AO|-5.56|12.19
Ajegunle|NG|6.45|3.33
Pristina|XK|42.67|21.17
Jiamusi|CN|46.8|130.31
Korla|CN|41.76|86.15
Kolhāpur|IN|16.7|74.23
Porto Velho|BR|-8.76|-63.9
San Miguel de Tucumán|AR|-26.82|-65.21
Kuantan|MY|3.81|103.33
Sevastopol|UA|44.61|33.52
Nellore|IN|14.45|79.99
Mirpur Model Thana|BD|23.81|90.36
Bremen|DE|53.08|8.81
Wanning|CN|18.8|110.38
Owerri|NG|5.48|7.03
Kota Kuala Muda|MY|5.59|100.37
Sungai Petani|MY|5.65|100.49
Xinzhou|CN|38.41|112.73
Kotō|JP|32.78|130.75
Kalaburagi|IN|17.34|76.84
Tucson|US|32.22|-110.93
Selayang Baru Utara|MY|3.25|101.67
Vilnius|LT|54.69|25.28
Ajmer|IN|26.45|74.64
Pingdu|CN|36.78|119.95
Fresno|US|36.75|-119.77
Mbeya|TZ|-8.9|33.45
Juiz de Fora|BR|-21.76|-43.35
Calabar|NG|4.96|8.33
Oujda|MA|34.68|-1.91
Novokuznetsk|RU|53.76|87.14
Ryazan’|RU|54.63|39.7
Ji’an|CN|27.12|114.98
Sahiwal|PK|31.97|72.33
Sahiwal|PK|30.67|73.1
Mersin|TR|36.81|34.64
Nilüfer|TR|40.21|28.92
Leeds|GB|53.8|-1.55
Poznań|PL|52.41|16.93
Aqsu|CN|41.18|80.28
Ebute Ikorodu|NG|6.6|3.49
Ananindeua|BR|-1.37|-48.37
Tanggu|CN|39.02|117.65
Pasir Gudang|MY|1.46|103.91
Astrakhan|RU|46.35|48.04
Okara|PK|30.81|73.45
Nansana|UG|0.36|32.53
Kimhae|KR|35.23|128.88
Ar Raqqah|SY|35.95|39.01
Québec|CA|46.81|-71.21
Cuauhtémoc|MX|19.45|-99.15
Shangluo|CN|33.87|109.93
Himeji|JP|34.82|134.7
Ibagué|CO|4.44|-75.2
Antwerp|BE|51.22|4.4
Assiut|EG|27.18|31.18
Hamadān|IR|34.8|48.51
Qionghai|CN|19.24|110.46
Aparecida de Goiânia|BR|-16.82|-49.24
Cangzhou|CN|38.31|116.85
Mohammadpur|BD|24.9|88.53
Surakarta|ID|-7.56|110.83
Yuanping|CN|38.72|112.76
San Salvador|SV|13.69|-89.19
Beihai|CN|21.48|109.12
Van|TR|38.49|43.38
Sacramento|US|38.58|-121.49
Thủ Đức|VN|10.85|106.77
Üsküdar|TR|41.02|29.01
Penza|RU|53.2|45.01
Mazār-e Sharīf|AF|36.71|67.11
Kandahār|AF|31.61|65.71
Hengshui|CN|37.74|115.68
Dehradun|IN|30.32|78.03
Erode|IN|11.34|77.73
Lyon|FR|45.75|4.85
Salta|AR|-24.81|-65.42
Serra|BR|-20.13|-40.31
Esenler|TR|41.04|28.88
Daxing’anling|CN|52.33|124.71
Qui Nhon|VN|13.78|109.22
Al Fayyum|EG|29.31|30.84
Durgapur|IN|23.52|87.31
Utsunomiya|JP|36.57|139.88
Victoria de Durango|MX|24.02|-104.66
Belford Roxo|BR|-22.76|-43.4
Lisbon|PT|38.73|-9.15
Rahim Yar Khan|PK|28.42|70.3
Ulhasnagar|IN|19.22|73.15
Guangyuan|CN|32.44|105.82
Loni|IN|28.75|77.29
Siliguri|IN|26.71|88.43
Nuremberg|DE|49.45|11.08
Niterói|BR|-22.88|-43.1
Ujjain|IN|23.18|75.78
Hannover|DE|52.37|9.73
Edinburgh|GB|55.95|-3.2
Macapá|BR|0.04|-51.07
Xianning|CN|29.84|114.32
Toulouse|FR|43.6|1.44
Thembisa|ZA|-26|28.23
Carrefour|HT|18.53|-72.4
Matsuyama|JP|33.84|132.77
Bilimora|IN|20.77|72.96
Kasur|PK|31.12|74.45
Atlanta|US|33.75|-84.39
Heroica Matamoros|MX|25.88|-97.5
Makati City|PH|14.55|121.03
Buda|HU|47.5|19.03
Tonghua|CN|41.72|125.93
Mianzhu, Deyang, Sichuan|CN|31.34|104.22
Naberezhnyye Chelny|RU|55.74|52.42
Lipetsk|RU|52.59|39.55
Kikwit|CD|-5.04|18.82
Florianópolis|BR|-27.6|-48.55
Banan|CN|29.38|106.54
Newcastle|AU|-32.93|151.78
Tuen Mun|HK|22.39|113.97
Zhangye|CN|38.93|100.45
Kirov|RU|58.6|49.66
Kashgar|CN|39.47|75.99
Mukim Pulai|MY|1.53|103.67
Najrān|SA|17.49|44.13
Karol Bāgh|IN|28.65|77.19
Zhoukou|CN|33.63|114.63
Leipzig|DE|51.34|12.37
Pingliang|CN|35.54|106.69
Kalininskiy|RU|60|30.39
Duisburg|DE|51.43|6.77
Āsansol|IN|23.68|86.98
Arāk|IR|34.09|49.7
Maipú|CL|-33.51|-70.77
Homyel'|BY|52.43|30.98
Aktobe|KZ|50.28|57.21
Kota Kinabalu|MY|5.97|116.07
Talatona|AO|-8.92|13.19
Kampung Larkin Lama|MY|1.5|103.74
Kota Damansara|MY|3.15|101.58
Jalalpur Pirwala|PK|29.51|71.22
Mangaluru|IN|12.92|74.86
Zhucheng|CN|35.99|119.4
Santa Marta|CO|11.24|-74.19
Matsudo|JP|35.78|139.9
Hāthazāri|BD|22.51|91.81
Lapu-Lapu City|PH|10.31|123.95
Karagandy|KZ|49.8|73.1
Loudi|CN|27.73|111.99
Liverpool|GB|53.41|-2.98
Ichikawa|JP|35.73|139.91
Sha Tin|HK|22.38|114.18
Dera Ghazi Khan|PK|30.05|70.64
Hecun|CN|36.53|114.11
Higashiosaka|JP|34.67|135.58
Pindi Bhattian|PK|31.9|73.27
Cheboksary|RU|56.13|47.25
Pohang|KR|36.03|129.36
Shanwei|CN|22.78|115.35
Montería|CO|8.75|-75.88
Ruiru|KE|-1.15|36.96
Valledupar|CO|10.47|-73.25
Belagavi|IN|15.85|74.5
Ajman|AE|25.4|55.48
Jianshui|CN|24.28|101.22
Sancaktepe|TR|41|29.23
Port Sudan|SD|19.62|37.22
Toluca|MX|19.29|-99.65
Ciudad López Mateos|MX|19.56|-99.26
Al Khuşūş|EG|30.15|31.32
Jeju City|KR|33.51|126.52
Gdańsk|PL|54.35|18.65
Miami|US|25.77|-80.19
Omaha|US|41.26|-95.94
Nishinomiya|JP|34.72|135.33
Masina|CD|-4.38|15.39
Sahāranpur|IN|29.97|77.55
Vellore|IN|12.92|79.13
Donghe|CN|40.57|110.02
Kurashiki|JP|34.58|133.77
Campos dos Goytacazes|BR|-21.75|-41.33
Angeles City|PH|15.15|120.58
Bhātpāra|IN|22.87|88.4
Jijiga|ET|9.35|42.8
Tula|RU|54.2|37.62
Najaf|IQ|32.03|44.35
Raleigh|US|35.77|-78.64
Imus|PH|14.43|120.94
Xichang|CN|27.9|102.26
Malegaon|IN|20.55|74.53
Zaoyang|CN|32.13|112.75
São José do Rio Preto|BR|-20.82|-49.38
Caxias do Sul|BR|-29.17|-51.18
Karabağlar|TR|38.38|27.13
Okene|NG|7.55|6.24
Uijeongbu-si|KR|37.74|127.05
Bristol|GB|51.46|-2.6
East London|ZA|-33.02|27.91
Chéngguān Qū|CN|29.64|91.04
Yazd|IR|31.9|54.37
Hargeysa|SO|9.56|44.07
Ōita|JP|33.23|131.6
Jincheng|CN|35.5|112.83
Hongjiang|CN|27.11|110
Modīnagar|IN|28.83|77.57
Taoyuan|TW|24.99|121.3
Eldoret|KE|0.52|35.27
Kansas City|US|39.1|-94.58
Yan’an|CN|36.6|109.49
Kaliningrad|RU|54.71|20.51
Skopje|MK|42|21.43
Kupang|ID|-10.17|123.61
Vereeniging|ZA|-26.67|27.93
The Hague|NL|52.08|4.3
Long Beach|US|33.77|-118.19
Gaya|IN|24.8|85
Iloilo|PH|10.7|122.56
Shouguang|CN|36.88|118.74
Jingdezhen|CN|29.29|117.21
Murcia|ES|37.99|-1.13
Mesa|US|33.42|-111.82
Halifax|CA|44.64|-63.58
Morogoro|TZ|-6.82|37.66
Marikina City|PH|14.65|121.11
Kenitra|MA|34.26|-6.58
Seeb|OM|23.67|58.19
Cilegon|ID|-6.01|106.05
Mykolayiv|UA|46.98|31.99
Fukuyama|JP|34.48|133.37
Staten Island|US|40.56|-74.14
Nanping|CN|26.65|118.17
Pereira|CO|4.81|-75.69
Ciudad Apodaca|MX|25.78|-100.19
São João de Meriti|BR|-22.8|-43.37
Ambattur|IN|13.1|80.16
Kanazawa|JP|36.6|136.62
Gonder|ET|12.6|37.47
Mandaluyong City|PH|14.58|121.04
Mixco|GT|14.63|-90.61
Longshan|CN|42.89|125.14
Ikare|NG|7.53|5.75
Nova Vida|AO|-8.91|13.22
Vũng Tàu|VN|10.35|107.08
Maracay|VE|10.25|-67.59
Tamale|GH|9.4|-0.84
Heyuan|CN|23.73|114.68
Dĩ An|VN|10.91|106.77
Kira|UG|0.4|32.63
Esna|EG|25.29|32.55
Huangshan|CN|29.71|118.31
Ḩamāh|SY|35.13|36.76
Jalgaon|IN|21|75.57
Kurnool|IN|15.83|78.04
Yola|NG|9.21|12.48
Tieling|CN|42.29|123.84
Rạch Giá|VN|10.01|105.08
Amagasaki|JP|34.72|135.42
Manado|ID|1.48|124.85
Santo Domingo de los Colorados|EC|-0.25|-79.18
Ţarţūs|SY|34.89|35.89
Mek'ele|ET|13.5|39.48
Nazrēt|ET|8.55|39.27
Colorado Springs|US|38.83|-104.82
Huancayo|PE|-12.07|-75.21
Al Hillah|IQ|32.46|44.42
Mbandaka|CD|0.05|18.26
Malanje|AO|-9.54|16.34
Namp’o|KP|38.74|125.41
Ciudad General Escobedo|MX|25.8|-100.32
Bacolod City|PH|10.67|122.95
Virginia Beach|US|36.85|-75.98
Wafangdian|CN|39.62|122.01
Mansilingan|PH|10.63|122.98
Kahama|TZ|-3.83|32.6
Hsinchu|TW|24.8|120.97
Katsushika|JP|35.73|139.85
Bornova|TR|38.48|27.24
Rāmgundam|IN|18.8|79.45
Batman|TR|37.89|41.13
Yongji|CN|34.87|110.44
Lishui|CN|28.46|119.91
Udaipur|IN|24.59|73.71
Warder|ET|6.97|45.34
Wenshan City|CN|23.36|104.25
Eslamshahr|IR|35.55|51.24
Juba|SS|4.85|31.58
Muratpaşa|TR|36.89|30.76
Bắc Giang|VN|21.27|106.19
Şanlıurfa|TR|37.17|38.79
Kursk|RU|51.73|36.18
Maheshtala|IN|22.51|88.25
Nam Định|VN|20.43|106.18
Constantine|DZ|36.37|6.61
Patiāla|IN|30.34|76.39
Boksburg|ZA|-26.21|28.26
Basuo|CN|19.1|108.67
Campina Grande|BR|-7.23|-35.88
Ensenada|MX|31.87|-116.6
Elazığ|TR|38.67|39.22
Jundiaí|BR|-23.19|-46.88
Xochimilco|MX|19.25|-99.1
Shyamnagar|IN|22.83|88.37
Dasmariñas|PH|14.33|120.94
Zhangjiajie|CN|29.13|110.48
Mataram|ID|-8.58|116.12
Korhogo|CI|9.46|-5.63
Piracicaba|BR|-22.73|-47.65
Fujisawa|JP|35.35|139.48
Bissau|GW|11.86|-15.6
Zhongxiang|CN|31.17|112.58
Sandakan|MY|5.84|118.12
Mawlamyine|MM|16.49|97.63
Laval|CA|45.57|-73.69
Palma|ES|39.57|2.65
Montes Claros|BR|-16.73|-43.86
Sunch’ŏn|KP|39.43|125.93
Sultangazi|TR|41.11|28.87
Uyo|NG|5.05|7.93
Bei’an|CN|48.27|126.6
Davangere|IN|14.47|75.93
Macheng|CN|31.18|115.02
Ado-Ekiti|NG|7.62|5.22
Manizales|CO|5.07|-75.51
Masan|KR|35.13|126.83
Buôn Ma Thuột|VN|12.67|108.04
Stavropol|RU|45.03|41.96
Shuozhou|CN|39.32|112.42
Kashiwa|JP|35.86|139.98
Ogbomoso|NG|8.13|4.24
Tel Aviv|IL|32.08|34.78
Buenaventura|CO|3.58|-77
Welkom|ZA|-27.98|26.74
Sham Shui Po|HK|22.33|114.16
Machida|JP|35.54|139.45
Venustiano Carranza|MX|19.44|-99.1
Zagazig|EG|30.59|31.5
Vinnytsya|UA|49.23|28.47
Ismailia|EG|30.6|32.27
Ningde|CN|26.66|119.52
Akola|IN|20.71|77
Kima Kieza|AO|-8.83|13.3
Cusco|PE|-13.53|-71.97
Jiuquan|CN|39.74|98.52
Veracruz|MX|19.18|-96.14
East Jerusalem|PS|31.78|35.23
Bryansk|RU|53.27|34.32
Maltepe|TR|40.94|29.16
Sumgayit|AZ|40.59|49.67
Tando Bago|PK|24.79|68.97
Kuala Terengganu|MY|5.33|103.14
Toyota|JP|35.08|137.15
Matadi|CD|-5.84|13.46
Al Kharj|SA|24.16|47.33
Wong Tai Sin|HK|22.35|114.18
Minna|NG|9.62|6.55
Mandaluyong|PH|14.58|121.04
Xalapa de Enríquez|MX|19.53|-96.92
Rajpur Sonarpur|IN|22.44|88.43
Bratislava|SK|48.15|17.11
Taman Petaling|MY|3.2|101.65
Shinagawa|JP|33.64|133.01
Al Ḩasakah|SY|36.5|40.75
Luxor|EG|25.7|32.64
London|CA|42.98|-81.23
Awasa|ET|7.06|38.48
Chimoio|MZ|-19.12|33.48
Tando Allahyar|PK|25.46|68.72
Daloa|CI|6.88|-6.45
Barra da Tijuca|BR|-23|-43.37
Dingxi|CN|35.57|104.62
Bamenda|CM|5.96|10.15
Tver|RU|56.86|35.9
Thái Nguyên|VN|21.59|105.85
Boa Vista|BR|2.82|-60.67
Rio Branco|BR|-9.97|-67.81
Oakland|US|37.8|-122.27
Christchurch|NZ|-43.53|172.63
Korba|IN|22.35|82.7
Takamatsu|JP|34.33|134.05
Kowloon City|HK|22.33|114.19
Santos|BR|-23.96|-46.33
Tirana|AL|41.33|19.82
Petrolina|BR|-9.4|-40.5
Mauá|BR|-23.67|-46.46
San Juan|PR|18.47|-66.11
Alor Setar|MY|6.12|100.36
Tongchuan|CN|34.9|108.95
Pasay|PH|14.54|121
Nuevo Laredo|MX|27.48|-99.52
Toyama|JP|36.7|137.22
Tétouan|MA|35.58|-5.37
Zürich|CH|47.37|8.55
Beylikdüzü|TR|40.98|28.64
Việt Trì|VN|21.32|105.4
Azcapotzalco|MX|19.49|-99.19
Tampa|US|27.95|-82.46
Bunamwaya|UG|0.25|32.56
Magnitogorsk|RU|53.4|59.01
Tulsa|US|36.15|-95.99
Jhānsi|IN|25.46|78.58
Tseung Kwan O|HK|22.33|114.25
Ciudad Bolívar|VE|8.12|-63.55
Kampung Kangkar Teberau|MY|1.53|103.75
Koumassi|CI|5.3|-3.97
San Nicolás de los Garza|MX|25.74|-100.3
Guyuan|CN|36.01|106.28
Wandsbek|DE|53.58|10.08
Minneapolis|US|44.98|-93.26
Jayapura|ID|-2.53|140.72
Thoothukudi|IN|8.77|78.13
Ardabīl|IR|38.25|48.29
Ballari|IN|15.14|76.92
Chaoyang|CN|41.57|120.46
Gaza|PS|31.5|34.47
Maringá|BR|-23.43|-51.94
Yokosuka|JP|35.28|139.67
Kom Ombo|EG|24.48|32.95
Saltivka|UA|50.02|36.35
Nagasaki|JP|32.75|129.88
Gujangbagh|CN|37.11|79.93
Tonalá|MX|20.62|-103.24
Zhijiang|CN|30.42|111.75
Panama City|PA|8.99|-79.52
Uvira|CD|-3.4|29.14
Hirakata|JP|34.81|135.65
Ivanovo|RU|57|40.97
Cumaná|VE|10.46|-64.18
Newcastle|ZA|-27.76|29.93
Gumi|KR|36.11|128.34
Brno|CZ|49.2|16.61
Jixi|CN|45.29|130.96
Diadema|BR|-23.69|-46.62
Kuching|MY|1.55|110.33
Gifu|JP|35.42|136.76
Caruaru|BR|-8.28|-35.98
Tongling|CN|30.95|117.78
Tarlac City|PH|15.48|120.6
Toyonaka|JP|34.78|135.47
Kassala|SD|15.45|36.4
Miyazaki|JP|31.92|131.42
Lekki|NG|6.45|3.48
Antofagasta|CL|-23.65|-70.4
Wah Cantt|PK|33.77|72.75
Bhāgalpur|IN|25.24|86.97
Agartala|IN|23.84|91.28
Dayrah|AE|25.27|55.3
West Jerusalem|IL|31.78|35.22
Bida|NG|9.08|6.01
Bunia|CD|1.56|30.25
Antakya|TR|36.21|36.16
Quận Mười|VN|10.77|106.67
Sunshine Coast|AU|-26.66|153.08
Kisumu|KE|-0.1|34.76
Luhansk|UA|48.57|39.31
Bengkulu|ID|-3.8|102.27
Barinas|VE|8.62|-70.23
Hancheng|CN|35.46|110.43
Vitória da Conquista|BR|-14.87|-40.84
Wichita|US|37.69|-97.34
Al Hoceïma|MA|35.25|-3.94
Szczecin|PL|53.43|14.55
Delmas|HT|18.54|-72.3
Liaozhong|CN|41.51|122.72
Vila Velha|BR|-20.33|-40.29
Bologna|IT|44.49|11.34
Sejong|KR|36.59|127.29
Cazenga|AO|-8.84|13.28
Samsun|TR|41.28|36.34
Tallinn|EE|59.44|24.75
Tanga|TZ|-5.07|39.1
El Obeid|SD|13.18|30.22
Lobito|AO|-12.36|13.54
Saurimo|AO|-9.66|20.39
Bauru|BR|-22.31|-49.06
Bello|CO|6.34|-75.56
Pasto|CO|1.21|-77.28
Gaomi|CN|36.38|119.75
Santa Fe|AR|-31.65|-60.71
San-Pédro|CI|4.75|-6.64
Gauriganj|IN|26.21|81.69
Makurdi|NG|7.73|8.52
Palu|ID|-0.91|119.87
Takoradi|GH|4.9|-1.76
Samut Prakan|TH|13.6|100.6
Arlington|US|32.74|-97.11
Khamis Mushait|SA|18.3|42.73
Ambato|EC|-1.25|-78.62
Carapicuíba|BR|-23.52|-46.83
Ojo de Agua|MX|19.68|-99.01
Windhoek|NA|-22.56|17.08
Abomey-Calavi|BJ|6.45|2.36
Bochum|DE|51.48|7.22
Suita|JP|34.76|135.52
Benito Juárez|MX|19.37|-99.16
Sector 3|RO|44.42|26.17
Chak Jhumra|PK|31.57|73.18
Kahramanmaraş|TR|37.58|36.93
Chongzuo|CN|22.38|107.37
Grajaú|BR|-23.77|-46.67
Okazaki|JP|34.95|137.17
Xico|MX|19.27|-98.95
Iztacalco|MX|19.4|-99.1
Kākināda|IN|16.96|82.24
Betim|BR|-19.97|-44.2
Las Palmas de Gran Canaria|ES|28.1|-15.42
Cotabato|PH|7.22|124.25
Bawshar|OM|23.58|58.4
Latur|IN|18.4|76.57
Tanzhou|CN|22.26|113.47
Wellington|NZ|-41.29|174.78
Mazatlán|MX|23.22|-106.42
Nizhny Tagil|RU|57.92|59.97
Irapuato|MX|20.67|-101.36
Ichinomiya|JP|35.3|136.8
Aswān|EG|24.09|32.9
Iaşi|RO|47.17|27.6
Krugersdorp|ZA|-26.09|27.78
Pānihāti|IN|22.69|88.37
Shibganj|BD|25|89.32
Caucaia|BR|-3.74|-38.65
Iquitos|PE|-3.75|-73.25
Toyohashi|JP|34.77|137.38
Hechuan|CN|29.99|106.26
Pétionville|HT|18.51|-72.29
Utrecht|NL|52.09|5.12
Rajamahendravaram|IN|17.01|81.78
Cariacica|BR|-20.26|-40.42
Yogyakarta|ID|-7.8|110.36
Dhule|IN|20.9|74.78
Yanzhou|CN|35.55|116.83
Minato|JP|34.22|135.15
Puchong|MY|3|101.62
Ondo|NG|7.09|4.84
Pingyin|CN|36.28|116.45
Rohtak|IN|28.89|76.59
Bhawana|PK|31.57|72.65
Rustenburg|ZA|-25.67|27.24
Bakersfield|US|35.37|-119.02
Xuanhua|CN|40.61|115.06
Emalahleni|ZA|-25.87|29.23
Bafoussam|CM|5.48|10.42
Thủ Dầu Một|VN|10.98|106.65
Takasaki|JP|36.33|139.02
Seremban|MY|2.73|101.94
Miguel Hidalgo|MX|19.43|-99.2
Nagano|JP|36.65|138.18
Tawau|MY|4.24|117.89
Cardiff|GB|51.48|-3.18
Dachang|CN|31.31|121.42
Đống Đa|VN|21.01|105.83
Chitungwiza|ZW|-18.01|31.08
Fenghuang|CN|27.94|109.6
Umuahia|NG|5.52|7.49
Puerto La Cruz|VE|10.21|-64.63
Uşak|TR|38.67|29.41
Bharatpur|NP|27.68|84.44
Itaquaquecetuba|BR|-23.49|-46.35
Natore|BD|24.41|88.99
6th of October City|EG|29.82|31.05
Leicester|GB|52.64|-1.13
Desna|UA|50.52|30.68
Cascavel|BR|-24.96|-53.46
Sector 6|RO|44.44|26.02
Canberra|AU|-35.28|149.13
Avellaneda|AR|-34.66|-58.37
Praia Grande|BR|-24.01|-46.4
Nara-shi|JP|34.69|135.8
Florence|IT|43.78|11.25
Ahilyanagar|IN|19.09|74.74
Kollam|IN|8.88|76.58
Huanggang|CN|30.45|114.87
Bradford|GB|53.79|-1.75
Sukabumi|ID|-6.92|106.93
Bilāspur|IN|22.08|82.16
Malabon|PH|14.67|120.94
Franca|BR|-20.54|-47.4
Cleveland|US|41.5|-81.7
Iseyin|NG|7.97|3.6
Etobicoke|CA|43.64|-79.57
Yenagoa|NG|4.93|6.27
Gboko|NG|7.32|9
Samba|AO|-8.88|13.2
Olinda|BR|-8.01|-34.86
Pyeongtaek|KR|36.99|127.09
Petare|VE|10.48|-66.81
Bến Cát|VN|11.15|106.6
Anqiu|CN|36.43|119.19
Alanya|TR|36.54|32
Larkana|PK|27.56|68.21
Al Qadarif|SD|14.03|35.38
Hrodna|BY|53.68|23.83
Cibinong|ID|-6.48|106.85
Nawabshah|PK|26.24|68.4
New Orleans|US|29.95|-90.08
Keelung|TW|25.13|121.74
Malmö|SE|55.61|13
Jizhou|CN|37.55|115.57
Manukau City|NZ|-36.99|174.88
Maradi|NE|13.5|7.1
Burewala|PK|30.17|72.65
Ataşehir|TR|40.98|29.12
Blumenau|BR|-26.92|-49.07
Nanqiao|CN|30.92|121.45
Mingora|PK|34.78|72.36
Santarém|BR|-2.44|-54.71
Wuppertal|DE|51.26|7.15
Ulan-Ude|RU|51.83|107.6
Huocheng|CN|44.05|80.87
Ijebu Ode|NG|6.82|3.92
Maseru|LS|-29.32|27.48
Bhilwara|IN|25.35|74.64
Aurora|US|39.73|-104.83
Vitebsk|BY|55.19|30.2
Sultanbeyli|TR|40.96|29.27
Taraz|KZ|42.9|71.37
Yangsan|KR|35.34|129.03
Dniprovskyi|UA|50.45|30.6
San Jose del Monte|PH|14.81|121.05
Abū al-Kahṣīb|IQ|30.44|47.88
Gwangmyeong|KR|37.48|126.87
Zanjan|IR|36.68|48.5
Neiva|CO|2.93|-75.28
Iwaki|JP|37.05|140.88
Vladimir|RU|56.14|40.4
Tete|MZ|-16.16|33.59
Bacoor|PH|14.46|120.94
Uberaba|BR|-19.75|-47.93
Wakayama|JP|34.23|135.17
Brahmapur|IN|19.31|84.79
Fengshan|TW|22.63|120.36
Fatih|TR|41.02|28.94
Misratah|LY|32.38|15.09
Cuíto|AO|-12.38|16.93
Benito Juarez|MX|19.4|-99.16
Kyzylorda|KZ|44.85|65.51
Sinjhoro|PK|26.03|68.81
Kawagoe|JP|35.91|139.49
Takatsuki|JP|34.85|135.62
Muzaffarpur|IN|26.12|85.39
Tapachula|MX|14.91|-92.26
Lhoka|CN|29.24|91.77
Villahermosa|MX|17.99|-92.94
Setapak|MY|3.21|101.73
Mahilyow|BY|53.91|30.34
Bandar Abbas|IR|27.19|56.28
Pravyi Bereh|UA|47.11|37.59
Yunusobod|UZ|41.37|69.28
Ras Al Khaimah|AE|25.79|55.94
Cabimas|VE|10.4|-71.45
Kendari|ID|-3.98|122.52
Honolulu|US|21.31|-157.86
Anaheim|US|33.84|-117.91
Tarsus|TR|36.92|34.89
Pengze|CN|29.9|116.55
Bahir Dar|ET|11.59|37.39
Punāsa|IN|22.24|76.39
Al Maḩmūdīyah|IQ|33.06|44.37
Diepsloot|ZA|-25.93|28.01
Xilinhot|CN|43.94|116.07
São José dos Pinhais|BR|-25.53|-49.21
Quelimane|MZ|-17.88|36.89
Arkhangel’sk|RU|64.55|40.55
Muzaffarnagar|IN|29.47|77.7
Hulunbuir|CN|49.21|119.76
Dumai|ID|1.67|101.44
Shinjuku|JP|35.69|139.71
Sikasso|ML|11.32|-5.67
Sanandaj|IR|35.31|47
Chita|RU|52.04|113.49
San Pedro|PH|14.36|121.05
Alicante|ES|38.35|-0.48
Bimbo|CF|4.26|18.42
Kalemyo|MM|23.19|94.06
Belfast|GB|54.6|-5.93
Long Bien|VN|21.03|105.9
Camagüey|CU|21.38|-77.92
Bilbao|ES|43.26|-2.93
Ambon|ID|-3.7|128.18
Brest|BY|52.11|23.72
Ribeirão das Neves|BR|-19.77|-44.09
Chifeng|CN|42.27|118.96
Central Coast|AU|-33.43|151.37
Corrientes|AR|-27.47|-58.83
Hŭngnam|KP|39.84|127.63
Avadi|IN|13.11|80.11
Yunlong|CN|34.25|117.25
Koshigaya|JP|35.89|139.79
Coventry|GB|52.41|-1.51
Belgorod|RU|50.6|36.58
Toamasina|MG|-18.15|49.4
Logan City|AU|-27.64|153.11
Ōtsu|JP|35|135.87
Kosti|SD|13.16|32.66
Qitaihe|CN|45.77|131
Doha|QA|25.29|51.53
Kadapa|IN|14.48|78.82
Nakano|JP|35.7|139.67
Cirebon|ID|-6.71|108.56
Turmero|VE|10.23|-67.47
Tokorozawa|JP|35.8|139.47
Cabanatuan City|PH|15.49|120.97
Pizhou|CN|34.31|117.95
Darnytsya|UA|50.42|30.7
Dire Dawa|ET|9.59|41.87
Annaba|DZ|36.9|7.77
Nice|FR|43.7|7.27
Iligan|PH|8.23|124.24
Soledad|CO|10.92|-74.76
Temara|MA|33.93|-6.91
Paulista|BR|-7.94|-34.87
Obalende|NG|6.45|3.42
Kukatpally|IN|17.48|78.41
Laixi|CN|36.86|120.53
Dihok|IQ|36.87|42.99
Kaluga|RU|54.53|36.27
Bắc Từ Liêm|VN|21.07|105.75
Celaya|MX|20.52|-100.81
Serekunda|GM|13.44|-16.68
Kafrul|BD|23.79|90.37
Karşıyaka|TR|38.46|27.11
Ḩadā’iq al Qubbah|EG|30.09|31.28
Makiyivka|UA|48.05|37.93
West Raleigh|US|35.79|-78.66
Cuernavaca|MX|18.93|-99.23
Markham|CA|43.87|-79.27
São Vicente|BR|-23.96|-46.39
Kaesŏng|KP|37.97|126.55
Tungi|BD|23.89|90.4
Krasnogvargeisky|RU|59.97|30.48
Randburg|ZA|-26.09|28
Safi|MA|32.3|-9.24
Simferopol|UA|44.96|34.11
Lublin|PL|51.25|22.57
Pelotas|BR|-31.77|-52.34
San José|CR|9.93|-84.08
Orlando|US|28.54|-81.38
Viña del Mar|CL|-33.02|-71.55
Qazvin|IR|36.27|50
Asahikawa|JP|43.77|142.36
Kāmārhāti|IN|22.67|88.37
Tepic|MX|21.51|-104.89
Wŏnju|KR|37.35|127.95
Wad Medani|SD|14.4|33.52
Quận Mười Một|VN|10.76|106.64
Nukus|UZ|42.46|59.61
Konak|TR|38.4|27.1
Maebashi|JP|36.4|139.08
Kita|JP|35.75|139.73
Ciudad Victoria|MX|23.74|-99.14
Soledad de Graciano Sánchez|MX|22.19|-100.94
Kochi|JP|33.55|133.53
Bielefeld|DE|52.03|8.53
Blida|DZ|36.47|2.83
Kwai Chung|HK|22.37|114.14
Mandaue City|PH|10.32|123.92
Ganja|AZ|40.68|46.36
Khorramshahr|IR|30.44|48.18
Bonn|DE|50.73|7.1
Mathura|IN|27.5|77.67
Hechi|CN|24.69|108.08
Bydgoszcz|PL|53.12|18.01
Smolensk|RU|54.78|32.05
Oral|KZ|51.25|51.43
Khorramabad|IR|33.49|48.36
Soyapango|SV|13.71|-89.14
Tongshan|CN|34.18|117.16
Guédiawaye|SN|14.77|-17.4
Plovdiv|BG|42.15|24.75
Ciudad Obregón|MX|27.49|-109.94
Wŏnsan|KP|39.15|127.44
Brent|GB|51.55|-0.3
Pavlodar|KZ|52.28|76.97
Chānda|IN|19.95|79.3
Canoas|BR|-29.92|-51.18
Kōriyama|JP|37.4|140.38
Sochi|RU|43.6|39.72
Aksaray|TR|38.37|34.03
Vijayapura|IN|16.82|75.72
Chipata|ZM|-13.63|32.65
Chongjin|KP|41.8|129.78
Yanji|CN|42.89|129.5
Roodepoort|ZA|-26.16|27.87
Pucallpa|PE|-8.38|-74.55
Mogi das Cruzes|BR|-23.52|-46.19
Córdoba|ES|37.89|-4.77
Birkenhead|GB|53.39|-3.01
Nantes|FR|47.22|-1.55
Ilesa|NG|7.63|4.74
Pekalongan|ID|-6.89|109.68
Bhatara|BD|23.8|90.45
Espoo|FI|60.21|24.65
Kikuyu|KE|-1.25|36.66
Kluang|MY|2.03|103.32
Lincang|CN|23.88|100.09
Nottingham|GB|52.95|-1.15
Ramiros|AO|-9.06|13.05
Al ‘Amārah|IQ|31.84|47.14
Volzhsky|RU|48.79|44.78
Vaughan|CA|43.84|-79.5
Xingyi|CN|25.1|104.91
Shivamogga|IN|13.93|75.57
Alwar|IN|27.56|76.63
Uíge|AO|-7.61|15.06
Taubaté|BR|-23.03|-45.56
Ixtapaluca|MX|19.32|-98.88
Osh|KG|40.53|72.8
Portoviejo|EC|-1.06|-80.45
Villavicencio|CO|4.13|-73.63
Man’gyŏngdae-ri|KP|38.99|125.66
Camaçari|BR|-12.7|-38.32
San Miguelito|PA|9.05|-79.47
Shāhjānpur|IN|27.88|79.91
Lexington|US|37.99|-84.48
Tantou|CN|22.75|113.83
Suzano|BR|-23.54|-46.31
Anápolis|BR|-16.33|-48.95
Kaech’ŏn|KP|39.7|125.89
Jūnāgadh|IN|21.52|70.46
Islington|GB|51.54|-0.1
Hoa Lư|VN|20.26|105.98
Holguín|CU|20.89|-76.26
Ust-Kamenogorsk|KZ|49.97|82.61
Tsuen Wan|HK|22.37|114.11
Zinder|NE|13.81|8.99
Saransk|RU|54.18|45.17
Al Diwaniyah|IQ|31.99|44.93
Varna|BG|43.22|27.91
Hafizabad|PK|32.07|73.69
Marne La Vallée|FR|48.84|2.64
Palangkaraya|ID|-2.21|113.92
Damanhur|EG|31.03|30.47
Chiniot|PK|31.72|72.98
Popayán|CO|2.44|-76.61
Reading|GB|51.46|-0.97
Geita|TZ|-2.87|32.23
Constanţa|RO|44.18|28.63
New Delhi|IN|28.62|77.21
Thessaloníki|GR|40.64|22.93
Thiès|SN|14.79|-16.93
Naha|JP|26.21|127.68
Riverside|US|33.95|-117.4
Baicheng|CN|45.62|122.83
Chimbote|PE|-9.08|-78.59
Bari|IT|41.12|16.87
Barueri|BR|-23.51|-46.88
Corpus Christi|US|27.8|-97.4
Thrissur|IN|10.52|76.22
Cherepovets|RU|59.13|37.9
Eloy Alfaro|EC|-2.17|-79.84
Hamburg-Nord|DE|53.59|9.98
Al-Kut|IQ|32.51|45.82
Muar|MY|2.04|102.57
Şişli|TR|41.06|28.99
Lexington-Fayette|US|38.05|-84.46
Maroua|CM|10.59|14.32
Kingston upon Hull|GB|53.74|-0.34
Preston|GB|53.76|-2.7
Lianshan|CN|40.76|120.85
Denizli|TR|37.77|29.09
Ikeja|NG|6.6|3.34
New Cairo|EG|30.03|31.47
Al Qāhirah al Jadīdah|EG|30.04|31.44
Vitória|BR|-20.32|-40.34
Palmira|CO|3.53|-76.3
Vologda|RU|59.22|39.88
Iligan City|PH|8.25|124.4
Catania|IT|37.49|15.07
Jardim Angela|BR|-23.72|-46.77
Nizāmābād|IN|18.67|78.1
Cincinnati|US|39.13|-84.51
Percut|ID|3.63|98.86
Coatzacoalcos|MX|18.15|-94.44
Santa Ana|US|33.75|-117.87
Sariwŏn-si|KP|38.51|125.76
Botshabelo|ZA|-29.27|26.73
Butuan|PH|8.95|125.54
Shahrīār|IR|35.66|51.06
Qods|IR|35.72|51.11
Gia Lâm|VN|21.02|105.94
Kurgan|RU|55.45|65.34
Tampico|MX|22.29|-97.88
Akowonjo|NG|6.61|3.31
Cabuyao|PH|14.27|121.13
Tabora|TZ|-5.02|32.83
Kasugai|JP|35.25|136.97
An Nhơn|VN|13.89|109.11
Alimosho|NG|6.61|3.3
Ciudad Benito Juárez|MX|25.65|-100.09
Münster|DE|51.96|7.63
Mannheim|DE|49.49|8.47
Karawang|ID|-6.31|107.32
Akita|JP|39.72|140.12
Tumkūr|IN|13.34|77.1
Chinju|KR|35.19|128.08
Parbhani|IN|19.27|76.77
Hisar|IN|29.15|75.72
Iksan|KR|35.94|126.95
Fīrozābād|IN|27.15|78.4
Palmas|BR|-10.17|-48.33
Vladikavkaz|RU|43.04|44.67
Port-de-Paix|HT|19.94|-72.83
Damietta|EG|31.42|31.81
Posadas|AR|-27.39|-55.92
Parauapebas|BR|-6.07|-49.9
Brakpan|ZA|-26.24|28.37
Stockton|US|37.96|-121.29
Juazeiro do Norte|BR|-7.21|-39.32
Yokkaichi|JP|34.97|136.62
Kulti|IN|23.73|86.84
Tláhuac|MX|19.29|-99.01
Sapele|NG|5.89|5.68
Kashan|IR|33.98|51.43
Kāshān|IR|34|51.44
Pittsburgh|US|40.44|-80
Armenia|CO|4.54|-75.67
Santa Catarina|MX|25.67|-100.46
Sumbawanga|TZ|-7.97|31.62
Orël|RU|52.97|36.08
Akashi|JP|34.66|135.01
Hai Bà Trưng|VN|21.01|105.85
Kurume|JP|33.32|130.52
Graz|AT|47.07|15.44
Saint Paul|US|44.94|-93.09
Saltivskyi|UA|50|36.32
Nghi Sơn|VN|19.33|105.82
Karnāl|IN|29.69|76.98
Changyi|CN|36.85|119.39
Ciudad del Este|PY|-25.5|-54.65
Rosetta|EG|31.4|30.42
Barddhamān|IN|23.26|87.86
Toshima|JP|35.76|139.74
Kediri|ID|-7.82|112.02
Solwezi|ZM|-12.17|26.39
Hamburg-Mitte|DE|53.55|10.02
Augsburg|DE|48.37|10.9
South Dublin|IE|53.29|-6.34
Valladolid|ES|41.66|-4.72
Miri|MY|4.4|113.99
Xinyi|CN|34.38|118.35
Mardan|PK|34.2|72.05
Surgut|RU|61.26|73.42
Swansea|GB|51.62|-3.94
San Pablo|PH|14.07|121.33
Newcastle upon Tyne|GB|54.97|-1.61
Gundupālaiyam|IN|11.94|79.8
Várzea Grande|BR|-15.65|-56.13
Gatineau|CA|45.48|-75.7
Yangshuo|CN|24.78|110.49
Biñan|PH|14.34|121.08
Malir Cantonment|PK|24.94|67.21
Winejok|SS|9.01|27.57
Batikent|TR|39.97|32.73
Mérida|VE|8.58|-71.17
Linqu|CN|36.52|118.54
Uruapan|MX|19.42|-102.06
Pātan|NP|27.68|85.31
Fergana|UZ|40.38|71.78
Bahía Blanca|AR|-38.72|-62.27
Santol|PH|15.16|120.57
Kaolack|SN|14.15|-16.07
Jember|ID|-8.17|113.7
Aomori|JP|40.82|140.73
Bārāsat|IN|22.72|88.48
Mulugu|IN|18.19|79.94
Foz do Iguaçu|BR|-25.55|-54.59
Bihār Sharīf|IN|25.2|85.52
Tegal|ID|-6.87|109.14
Grozny|RU|43.31|45.69
Boma|CD|-5.85|13.05
Bāli|IN|22.65|88.34
Pu'er|CN|22.79|100.97
Rāmpur|IN|28.81|79.03
Darbhanga|IN|26.15|85.9
Panipat|IN|29.39|76.97
Mwene|CD|-9.82|22.87
Białystok|PL|53.13|23.16
São José|BR|-27.62|-48.63
Rufisque|SN|14.72|-17.27
Murmansk|RU|68.97|33.1
Tirupati|IN|13.64|79.42
Southend-on-Sea|GB|51.54|0.71
Petrópolis|BR|-22.5|-43.18
Guarujá|BR|-23.99|-46.26
Itajaí|BR|-26.91|-48.66
Lincoln|US|40.8|-96.67
Phu Quoc|VN|10.22|103.97
Baiyin|CN|36.55|104.17
Fukushima|JP|37.75|140.47
Bergen|NO|60.39|5.32
Greater Noida|IN|28.5|77.54
Noida|IN|28.58|77.33
Tambov|RU|52.74|41.44
Vigo|ES|42.23|-8.72
Aizawl|IN|23.73|92.72
Banjarbaru|ID|-3.44|114.84
Thanh Xuân|VN|20.99|105.8
Al Hufūf|SA|25.36|49.59
Cholula|MX|19.06|-98.3
Gandhinagar|IN|23.22|72.68
Semey|KZ|50.42|80.25
Cầu Giấy|VN|21.03|105.8
Dindigul|IN|10.37|77.98
Ponta Grossa|BR|-25.09|-50.16
Gaozhou|CN|21.92|110.86
Kamoke|PK|31.98|74.22
Limeira|BR|-22.56|-47.4
Thanjavur|IN|10.79|79.14
Kariega|ZA|-33.76|25.4
Adıyaman|TR|37.76|38.28
Al Mubarraz|SA|25.41|49.59
Resistencia|AR|-27.46|-58.99
Morioka|JP|39.7|141.15
Atyrau|KZ|47.1|51.88
Sector 2|RO|44.45|26.13
Xiuying|CN|20|110.29
San Cristóbal|VE|7.77|-72.24
Cileungsir|ID|-6.39|106.96
Karīmnagar|IN|18.44|79.13
Victoria|CA|48.44|-123.35
Anchorage|US|61.22|-149.9
Dewas|IN|22.97|76.06
Batna|DZ|35.56|6.17
Kaunas|LT|54.9|23.91
Sonīpat|IN|28.99|77.02
Machala|EC|-3.26|-79.96
Wiesbaden|DE|50.09|8.24
Meads|US|38.41|-82.71
Kabwe|ZM|-14.45|28.45
Sinŭiju|KP|40.1|124.4
Meguro|JP|35.63|139.7
Sector 4|RO|44.38|26.12
Sumida|JP|35.73|139.82
Ibaraki|JP|34.82|135.57
Bắc Ninh|VN|21.19|106.08
Ichalkaranji|IN|16.69|74.46
Marienthal|DE|53.57|10.08
Phú Mỹ|VN|10.63|107.07
Ceilândia|BR|-15.81|-48.13
Katowice|PL|50.26|19.02
Adapazarı|TR|40.78|30.4
Cluj-Napoca|RO|46.77|23.6
Gunpo|KR|37.37|126.95
Songea|TZ|-10.68|35.65
Butembo|CD|0.14|29.29
Tacna|PE|-18.01|-70.25
Tin Shui Wai|HK|22.46|114
Long Xuyên|VN|10.39|105.44
Savar|BD|23.85|90.25
Bathinda|IN|30.21|74.94
Henderson|US|36.04|-114.98
Jālna|IN|19.84|75.89
Sekondi|GH|4.93|-1.71
São Gonçalo|BR|-22.83|-43.05
Kyengera|UG|0.3|32.5
Greensboro|US|36.07|-79.79
Haifa|IL|32.81|35
Århus|DK|56.16|10.21
Dengzhou|CN|32.68|112.09
Artux|CN|39.71|76.18
Chuncheon|KR|37.87|127.73
Alto Barinas|VE|8.59|-70.23
Mbour|SN|14.42|-16.96
Brighton|GB|50.83|-0.14
Karlsruhe|DE|49.01|8.4
Port Moresby|PG|-9.48|147.15
Minya|EG|28.09|30.76
Plano|US|33.02|-96.7
Marabá|BR|-5.38|-49.13
Ichihara|JP|35.52|140.08
Qibao|CN|31.15|121.36
Kirāri Sulemānnagar|IN|28.7|77.06
Cainta|PH|14.58|121.12
Satna|IN|24.58|80.83
Geelong|AU|-38.15|144.36
Chernihiv|UA|51.51|31.29
Xinyuan|CN|43.43|83.25
Chapecó|BR|-27.1|-52.62
Ba Vì|VN|21.08|105.38
Valparaíso|CL|-33.04|-71.63
Ica|PE|-14.08|-75.73
Purnia|IN|25.78|87.47
Newark|US|40.74|-74.17
Itagüí|CO|6.18|-75.6
Nicolás Romero|MX|19.64|-99.31
Gebze|TR|40.8|29.43
Lichinga|MZ|-13.31|35.24
Narsingdi|BD|23.92|90.72
Zeytinburnu|TR|40.99|28.9
Ostrava|CZ|49.83|18.28
Sfax|TN|34.74|10.76
Zumpango|MX|19.8|-99.1
Merkezefendi|TR|37.81|29.04
Madison|US|43.07|-89.4
Bukhara|UZ|39.77|64.43
Wollongong|AU|-34.42|150.89
Volta Redonda|BR|-22.52|-44.1
St. Louis|US|38.63|-90.2
Poltava|UA|49.59|34.55
Sumaré|BR|-22.82|-47.27
Efon-Alaaye|NG|7.66|4.92
Binjai|ID|3.6|98.49
Pematangsiantar|ID|2.96|99.07
Petrozavodsk|RU|61.78|34.35
Enshi|CN|30.3|109.48
Taganrog|RU|47.24|38.91
Santa Teresa del Tuy|VE|10.23|-66.66
Quảng Ngãi|VN|15.12|108.79
Qarshi|UZ|38.86|65.79
Tanghe|CN|32.69|112.83
Demra|BD|23.71|90.48
Coacalco|MX|19.63|-99.11
Sincelejo|CO|9.3|-75.39
Khomeynī Shahr|IR|32.69|51.54
Kostroma|RU|57.77|40.93
Imphal|IN|24.81|93.94
Gagnoa|CI|6.13|-5.95
Ulu Bedok|SG|1.33|103.93
Bedok New Town|SG|1.33|103.94
Owo|NG|7.2|5.59
Suncheon|KR|34.95|127.49
Fangchenggang|CN|21.77|108.36
Komsomolsk-on-Amur|RU|50.55|137.01
Abbottabad|PK|34.15|73.21
Kaili|CN|26.59|107.98
Hakodate|JP|41.78|140.74
Yamoussoukro|CI|6.82|-5.28
Bab Ezzouar|DZ|36.73|3.18
Strasbourg|FR|48.58|7.75
Saugor|IN|23.84|78.74
Neihu|TW|25.08|121.59
Tsu|JP|34.73|136.52
Xingning|CN|24.15|115.72
Linxia Chengguanzhen|CN|35.6|103.21
Khmelnytskyi|UA|49.42|26.98
Kushinagar|IN|26.74|83.89
Saddiqabad|PK|28.31|70.13
Loja|EC|-3.99|-79.2
Tai Po|HK|22.45|114.17
Isfara|TJ|40.13|70.63
Luena|AO|-11.78|19.92
Taboão da Serra|BR|-23.63|-46.79
Istaravshan|TJ|39.91|69
Turpan|CN|42.95|89.18
Rourkela|IN|22.22|84.86
Yao|JP|34.62|135.6
Banī Suwayf|EG|29.07|31.1
Imperatriz|BR|-5.53|-47.49
Nagar Naluākot|BD|24.16|90.77
Guantánamo|CU|20.14|-75.21
Baguio|PH|16.42|120.59
Ar Rayyān|QA|25.29|51.42
Polokwane|ZA|-23.9|29.47
Ljubljana|SI|46.05|14.51
Jalālābād|AF|34.43|70.45
Deir ez-Zor|SY|35.34|40.14
Gijón|ES|43.54|-5.66
Santa Maria|BR|-29.68|-53.81
Parnamirim|BR|-5.92|-35.26
Hafar Al-Batin|SA|28.43|45.97
Kakogawachō-honmachi|JP|34.77|134.83
Sector 5|RO|44.39|26.07
Quận Sáu|VN|10.75|106.65
Capao Redondo|BR|-23.67|-46.78
Mỹ Tho|VN|10.36|106.36
Mito|JP|36.35|140.45
Derby|GB|52.92|-1.48
Dessie|ET|11.13|39.63
Hạ Long|VN|20.95|107.07
Gelsenkirchen|DE|51.51|7.1
Longling County|CN|24.59|98.69
Cherkasy|UA|49.44|32.06
Malolos|PH|14.84|120.81
Southampton|GB|50.9|-1.4
Kapar|MY|3.13|101.38
Çorum|TR|40.55|34.95
Ghulja|CN|43.92|81.32
Eimsbüttel|DE|53.57|9.96
Merlo|AR|-34.67|-58.73
Yeosu|KR|34.76|127.66
Durg|IN|21.19|81.28
Fuling|CN|29.71|107.39
Mokpo|KR|34.81|126.39
Birgañj|NP|27.02|84.88
Yoshkar-Ola|RU|56.64|47.89
Russeifa|JO|32.02|36.05
Banda Aceh|ID|5.54|95.33
Shibīn al Kawm|EG|30.55|31.01
Mirpur Khas|PK|25.53|69.01
Sengkang New Town|SG|1.39|103.89
Floridablanca|CO|7.06|-73.09
Tokushima|JP|34.07|134.57
Sterlitamak|RU|53.64|55.95
Anantapur|IN|14.68|77.61
Gyeongsan-si|KR|35.82|128.74
Sohag|EG|26.56|31.69
Nagaoka|JP|37.45|138.85
Sapopemba|BR|-23.6|-46.52
Saint-Marc|HT|19.11|-72.7
Governador Valadares|BR|-18.85|-41.95
Eixample|ES|41.39|2.16
São Carlos|BR|-22.02|-47.89
Bagerhat|BD|22.66|89.79
Az-Zuhūr|EG|31.27|32.26
Hà Tĩnh|VN|18.34|105.91
Saskatoon|CA|52.13|-106.67
Chengzhong|CN|30.94|113.55
Djelfa|DZ|34.67|3.26
Chula Vista|US|32.64|-117.08
Shimonoseki|JP|33.96|130.94
Toledo|US|41.66|-83.56
Ulanhot|CN|46.08|122.08
Kibaha|TZ|-6.77|38.92
Hulan Ergi|CN|47.2|123.63
Tampines Estate|SG|1.36|103.94
Bordeaux|FR|44.84|-0.58
Aachen|DE|50.78|6.08
Gent|BE|51.05|3.72
Gravataí|BR|-29.94|-50.99
Cité Soleil|HT|18.58|-72.34
Mantampay|PH|8.17|124.22
Ratlām|IN|23.33|75.04
Nogales|MX|31.31|-110.94
El Daein|SD|11.46|26.13
Donghai|CN|22.95|115.64
Dezful|IR|32.38|48.41
Gunsan|KR|35.98|126.71
Mossoró|BR|-5.19|-37.34
Macaé|BR|-22.38|-41.78
Rānipet|IN|12.92|79.33
Brāhmanbāria|BD|23.97|91.11
Porto-Novo|BJ|6.5|2.6
Chernivtsi|UA|48.29|25.93
Jersey City|US|40.73|-74.08
Manta|EC|-0.95|-80.73
Reno|US|39.53|-119.81
Bégoua|CF|4.45|18.53
Riobamba|EC|-1.67|-78.66
Sivas|TR|39.75|37.02
Dourados|BR|-22.22|-54.81
Rondonópolis|BR|-16.47|-54.64
Wolverhampton|GB|52.59|-2.12
Huayin|CN|34.57|110.07
Pasarkemis|ID|-6.17|106.53
Fanling|HK|22.49|114.14
Chiayi City|TW|23.48|120.45
Dongtai|CN|32.85|120.31
Fuchū|JP|35.67|139.48
Jurong Town|SG|1.33|103.72
Marāgheh|IR|37.39|46.24
Marāgheh|IR|35.83|59.63
Quilmes|AR|-34.72|-58.25
Fukui-shi|JP|36.06|136.22
Lal Bahadur Nagar|IN|17.35|78.56
Mönchengladbach|DE|51.19|6.44
Bagong Silang|PH|14.78|121.04
Zhytomyr|UA|50.26|28.68
Karamay|CN|45.58|84.89
Sacomã|BR|-23.63|-46.6
Arrah|IN|25.56|84.66
Tongliao|CN|43.61|122.27
Bariadi|TZ|-2.8|33.98
Antsirabe|MG|-19.87|47.03
Chandler|US|33.31|-111.84
Yei|SS|4.09|30.68
Chilanzar|UZ|41.28|69.18
Tampere|FI|61.5|23.79
Mahajanga|MG|-15.72|46.32
Minato City|JP|35.66|139.75
Fort Wayne|US|41.13|-85.13
Plymouth|GB|50.37|-4.14
Nianbo|CN|36.48|102.42
Baranagar|IN|22.64|88.38
Skardu|PK|35.3|75.63
Marawi City|PH|8|124.28
Tampines New Town|SG|1.35|103.95
Embu das Artes|BR|-23.65|-46.85
Qo‘qon|UZ|40.53|70.94
Jardim Sao Luis|BR|-23.68|-46.74
Tacloban|PH|11.24|125
São José de Ribamar|BR|-2.56|-44.06
Changle|CN|36.71|118.83
Gajuwaka|IN|17.7|83.22
Jining|CN|41.03|113.11
North Shore|NZ|-36.8|174.75
Rishon LeTsiyyon|IL|31.97|34.79
Hiratsuka|JP|35.33|139.34
Stoke-on-Trent|GB|53|-2.19
Buffalo|US|42.89|-78.88
Verona|IT|45.44|10.99
Ðà Lạt|VN|11.95|108.44
San Salvador de Jujuy|AR|-24.19|-65.29
Durham|US|35.99|-78.9
Shiqi|CN|22.52|113.39
Etāwah|IN|26.78|79.02
Gasteiz / Vitoria|ES|42.85|-2.67
Rugao|CN|32.37|120.58
Gómez Palacio|MX|25.57|-103.5
St. Petersburg|US|27.77|-82.68
L'Hospitalet de Llobregat|ES|41.36|2.1
Gdynia|PL|54.52|18.53
Cilacap|ID|-7.73|109.01
Irvine|US|33.67|-117.82
Kitchener|CA|43.43|-80.51
Suicheng|CN|33.9|117.93
Nada|CN|19.52|109.58
Latina|ES|40.39|-3.75
Los Mochis|MX|25.79|-109
Bratsk|RU|56.13|101.61
Pachuca de Soto|MX|20.12|-98.73
Chingola|ZM|-12.53|27.88
Sumy|UA|50.92|34.8
Milton Keynes|GB|52.04|-0.76
Indaiatuba|BR|-23.09|-47.21
Laredo|US|27.51|-99.51
Juazeiro|BR|-9.41|-40.5
Vila Flor|AO|-8.98|13.31
Germiston|ZA|-26.21|28.16
Ñuñoa|CL|-33.45|-70.58
Parakou|BJ|9.34|2.63
Isiro|CD|2.77|27.62
Sari|IR|36.56|53.06
Tarakan|ID|3.31|117.59
Kenema|SL|7.88|-11.19
Oaxaca|MX|17.06|-96.73
Mossamedes|AO|-15.2|12.15
Al Madīnah|IQ|30.96|47.27
Hobart|AU|-42.88|147.33
Ikot Ekpene|NG|5.18|7.71
Woodlands|SG|1.44|103.79
Hanam|KR|37.54|127.21
Mueang Nonthaburi|TH|13.86|100.51
Muridke|PK|31.8|74.26
Saint-Louis|SN|16.02|-16.49
Batu Caves|MY|3.24|101.68
Novo Hamburgo|BR|-29.68|-51.13
Jurong West|SG|1.35|103.72
Singkawang|ID|0.91|108.98
Cox’s Bāzār|BD|21.44|92.01
Carabanchel|ES|40.39|-3.72
Cotia|BR|-23.6|-46.92
Petaẖ Tiqva|IL|32.09|34.89
Marg‘ilon|UZ|40.47|71.72
Ambarnath|IN|19.2|73.17
Godomè|BJ|6.39|2.35
Naihāti|IN|22.89|88.42
Braşov|RO|45.65|25.61
Xuân Lộc|VN|10.93|107.23
Richards Bay|ZA|-28.78|32.04
Qina|EG|26.16|32.73
Bharatpur|IN|27.22|77.49
Vantaa|FI|60.29|25.04
Porto|PT|41.15|-8.61
Kiel|DE|54.32|10.13
El Fasher|SD|13.63|25.35
Thiès Nones|SN|14.78|-16.97
Suihua|CN|46.65|126.97
Los Teques|VE|10.35|-67.04
Santiago del Estero|AR|-27.8|-64.26
Sétif|DZ|36.19|5.41
Begusarai|IN|25.42|86.13
Borūjerd|IR|33.9|48.75
Qarchak|IR|35.43|51.58
Afyonkarahisar|TR|38.76|30.54
İskenderun|TR|36.59|36.17
Santiago de Surco|PE|-12.14|-77.01
Maracanaú|BR|-3.88|-38.63
Ota|NG|6.69|3.23
Thika|KE|-1.03|37.07
San Fernando|PH|15.03|120.68
Menongue|AO|-14.66|17.69
Ḩayy Khildā|JO|31.99|35.84
Jacareí|BR|-23.31|-45.97
Jimma|ET|7.67|36.83
Timişoara|RO|45.75|21.23
Santa Clara|CU|22.41|-79.97
Iwo|NG|7.64|4.18
A Coruña|ES|43.37|-8.4
Libertad|PH|8.94|125.5
Altona|DE|53.55|9.93
La Paz|MX|24.14|-110.31
Kelar|IQ|34.63|45.32
Colonia del Valle|MX|19.39|-99.16
Niš|RS|43.32|21.9
Singa|SD|13.15|33.93
San Bernardo|CL|-33.59|-70.7
Sōka|JP|35.84|139.8
Mzuzu|MW|-11.47|34.02
Navotas|PH|14.67|120.95
Tiruvottiyūr|IN|13.16|80.3
Cidade Ademar|BR|-23.67|-46.66
Burnaby|CA|49.27|-122.95
Lubbock|US|33.58|-101.86
Palermo|AR|-34.59|-58.43
Thị Trấn Đông Triều|VN|21.08|106.51
Thuqbah|SA|26.26|50.2
Yamagata|JP|38.23|140.37
Tehuacán|MX|18.46|-97.4
Guarenas|VE|10.47|-66.62
Laferrere|AR|-34.75|-58.58
Montpellier|FR|43.61|3.88
Jimeta|NG|9.28|12.46
Częstochowa|PL|50.8|19.12
Gāndhīdhām|IN|23.08|70.13
Beibei|CN|29.83|106.44
Insein|MM|16.89|96.1
City of Westminster|GB|51.5|-0.14
Gilbert|US|33.35|-111.79
Chemnitz|DE|50.84|12.93
Paraná|AR|-31.73|-60.53
San Miguel|SV|13.48|-88.18
Shijie|CN|23.1|113.79
Chitato|AO|-7.3|20.73
Orsk|RU|51.23|58.49
Vanderbijlpark|ZA|-26.71|27.84
Coro|VE|11.41|-69.68
Americana|BR|-22.74|-47.33
Hami|CN|42.83|93.51
Gaborone|BW|-24.65|25.91
Al ‘Āshir min Ramaḑān|EG|30.3|31.75
Mau|IN|25.94|83.56
Puerto Montt|CL|-41.47|-72.94
Northampton|GB|52.25|-0.88
Juliaca|PE|-15.5|-70.13
Fuji|JP|35.17|138.68
Gyeongju|KR|35.84|129.21
Águas Lindas de Goiás|BR|-15.76|-48.28
Sinfra|CI|6.62|-5.91
Syktyvkar|RU|61.66|50.82
Gorgān|IR|36.84|54.44
Nizhnevartovsk|RU|60.93|76.55
Shahkot|PK|31.57|73.49
Groningen|NL|53.22|6.57
Biratnagar|NP|26.46|87.27
Braunschweig|DE|52.27|10.53
Valera|VE|9.32|-70.6
Sīkar|IN|27.61|75.14
Bago|MM|17.34|96.48
Magdeburg|DE|52.13|11.63
Baruta|VE|10.43|-66.88
Puente de Vallecas|ES|40.39|-3.66
Magé|BR|-22.65|-43.04
Trabzon|TR|41.01|39.73
Tri-Cities|US|46.25|-119.2
Jessore|BD|23.17|89.21
Manisa|TR|38.61|27.43
Arapiraca|BR|-9.75|-36.66
Rivne|UA|50.62|26.24
Padangsidempuan|ID|1.38|99.27
Probolinggo|ID|-7.75|113.22
Sabzevar|IR|36.21|57.68
Musaffah|AE|24.36|54.48
Brasilandia|BR|-23.45|-46.69
Sasebo|JP|33.17|129.73
Angarsk|RU|52.56|103.91
Mar’ino|RU|55.65|37.72
Ramagundam|IN|18.76|79.47
Hāpur|IN|28.73|77.78
Chigasaki|JP|35.34|139.4
Toli-Toli|ID|1.04|120.82
Chōfu|JP|35.66|139.55
Berbera|SO|10.44|45.01
Jiyuan|CN|35.09|112.59
Yamato|JP|35.47|139.45
Man|CI|7.41|-7.55
Bahawalnagar|PK|30|73.25
Bahawalnagar|PK|30.55|73.39
Novorossiysk|RU|44.73|37.76
Tsukuba|JP|36.08|140.12
Arica|CL|-18.48|-70.3
Peñalolén|CL|-33.47|-70.53
Rio Verde|BR|-17.8|-50.93
Laohekou|CN|32.39|111.67
Hải Dương|VN|20.94|106.33
Winston-Salem|US|36.1|-80.24
Farrukhābād|IN|27.39|79.58
Matsumoto|JP|36.23|137.97
Alappuzha|IN|9.49|76.33
Itapevi|BR|-23.55|-46.93
Katihar|IN|25.54|87.57
Buenaventura|CO|3.88|-77.03
Ciudad Ojeda|VE|10.2|-71.31
Gucun|CN|31.35|121.39
Glendale|US|33.54|-112.19
Xiulin|CN|29.72|112.4
Navegantes|AO|-12.59|13.39
Bunkyo|JP|35.53|139.42
Itaboraí|BR|-22.74|-42.86
Klang|MY|3.04|101.44
Almendares|CU|23.11|-82.42
Golestān|IR|35.52|51.18
Vyhurivshchyna-Troyeshchyna|UA|50.51|30.6
Khimki|RU|55.9|37.43
Horlivka|UA|48.3|38.02
Nacala|MZ|-14.56|40.69
Obolon|UA|50.51|30.51
Xiantao|CN|30.37|113.44
Nalchik|RU|43.5|43.62
Hachinohe|JP|40.5|141.5
Sete Lagoas|BR|-19.47|-44.25
Osan|KR|37.15|127.07
Fuencarral|ES|40.5|-3.68
Lille|FR|50.63|3.06
Neyagawa|JP|34.77|135.63
Ormoc|PH|11.01|124.61
Cabo Frio|BR|-22.89|-42.03
Magdalena Contreras|MX|19.33|-99.21
Nāgarpur|BD|24.06|89.88
Kasulu|TZ|-4.58|30.1
Ngaoundéré|CM|7.33|13.58
Ivano-Frankivsk|UA|48.92|24.71
Balıkesir|TR|39.65|27.89
Temuco|CL|-38.74|-72.6
Norfolk|US|36.85|-76.29
Krefeld|DE|51.34|6.55
Halle (Saale)|DE|51.48|11.98
Sri Ganganagar|IN|29.92|73.87
Marília|BR|-22.21|-49.95
Amarapura|MM|21.91|96.05
Kilamba|AO|-8.85|13.28
Āmol|IR|36.47|52.35
Freiburg|DE|48|7.85
Athlone|ZA|-33.97|18.5
Batangas|PH|13.76|121.06
Al Jubayl|SA|27.02|49.62
Tŏkch’ŏn|KP|39.75|126.26
Oldham|GB|53.54|-2.12
Pathein|MM|16.78|94.73
Hialeah|US|25.86|-80.28
Kunri|PK|25.18|69.57
Sylhet|BD|24.9|91.87
Paarl|ZA|-33.73|18.98
Garland|US|32.91|-96.64
Podgorica|ME|42.44|19.26
Scottsdale|US|33.51|-111.9
Hortolândia|BR|-22.86|-47.22
Irving|US|32.81|-96.95
Centurion|ZA|-25.86|28.19
Qingzhou|CN|36.7|118.48
Pākdasht|IR|35.48|51.68
Kajang|MY|2.99|101.79
Campo Limpo|BR|-23.64|-46.77
Yuci|CN|37.68|112.73
Sant Martí|ES|41.42|2.2
Eindhoven|NL|51.44|5.48
Boise|US|43.61|-116.2
Rewa|IN|24.53|81.29
Yakutsk|RU|62.03|129.72
Bole|CN|44.89|82.07
Muzaffargarh|PK|30.07|71.19
Chesapeake|US|36.82|-76.27
Uluberiya|IN|22.48|88.1
Ipatinga|BR|-19.47|-42.54
Dali|CN|25.58|100.21
Najafābād|IR|32.63|51.37
Thành Phố Bà Rịa|VN|10.5|107.17
Georgetown|GY|6.8|-58.16
Xiangxiang|CN|27.73|112.53
Kismayo|SO|-0.36|42.55
North Las Vegas|US|36.2|-115.12
Elche|ES|38.26|-0.7
Presidente Prudente|BR|-22.13|-51.39
Sivakasi|IN|9.45|77.8
Kindu|CD|-2.94|25.92
Digri|PK|25.16|69.11
Nizhnekamsk|RU|55.64|51.82
Karur|IN|10.96|78.08
Lubuklinggau|ID|-3.29|102.86
Craiova|RO|44.32|23.8
Rāichūr|IN|16.21|77.36
Pallāvaram|IN|12.97|80.15
Danlí|HN|14.03|-86.58
Yongkang|TW|23.02|120.26
Bo|SL|7.96|-11.74
Granada|ES|37.19|-3.61
Ooty|IN|11.41|76.7
Saga|JP|33.23|130.3
Magugpo Poblacion|PH|7.45|125.8
Dzerzhinsk|RU|56.24|43.46
Pemba|MZ|-12.97|40.52
Geoje|KR|34.81|128.71
Teluk Intan|MY|4.02|101.02
Singida|TZ|-4.82|34.74
Kigoma|TZ|-4.88|29.63
Colombo|BR|-25.29|-49.22
Fremont|US|37.55|-121.99
Kampong Baharu Cheras Batu Sebelas|MY|3.05|101.77
Viamão|BR|-30.08|-51.02
Jiayuguan|CN|39.81|98.29
Abadan|IR|30.34|48.3
Taytay|PH|14.56|121.13
Phổ Yên|VN|21.42|105.89
Neuquén|AR|-38.95|-68.06
Divinópolis|BR|-20.14|-44.89
Türkmenabat|TM|39.07|63.58
Shibuya|JP|35.66|139.71
Sơn Tây|VN|21.14|105.51
Ninh Hòa|VN|12.49|109.12
Pasir Mas|MY|6.05|102.14
Purwokerto|ID|-7.42|109.23
José C. Paz|AR|-34.52|-58.77
Marka|SO|1.72|44.77
Pāli|IN|25.77|73.32
Ḩalwān|EG|29.84|31.3
Atani|NG|6.01|6.75
Mariupol|UA|47.1|37.54
Huanren|CN|41.26|125.37
Changzheng|CN|31.24|121.37
Kasukabe|JP|35.98|139.75
Paris 15 Vaugirard|FR|48.84|2.3
Windsor|CA|42.3|-83.02
Hosūr|IN|12.74|77.83
Spokane|US|47.66|-117.43
Tripoli|LB|34.43|35.84
Longueuil|CA|45.52|-73.47
Ordu|TR|40.98|37.89
San Fernando de Apure|VE|7.89|-67.47
Croix-des-Bouquets|HT|18.58|-72.23
Lucena|PH|13.93|121.62
Yishun New Town|SG|1.43|103.83
Vizianagaram|IN|18.12|83.41
Jinchang|CN|38.5|102.19
Phan Thiết|VN|10.93|108.1
Şabyā|SA|17.15|42.63
Netanya|IL|32.33|34.86
Ciudad Lineal|ES|40.45|-3.65
Meycauayan|PH|14.74|120.96
Bexley|GB|51.44|0.15
Aliayabiagba|NG|6.45|3.33
Nassau|BS|25.06|-77.34
San Lorenzo|PY|-25.34|-57.51
Rennes|FR|48.11|-1.67
Mohammedia|MA|33.69|-7.38
Guatire|VE|10.47|-66.54
Tanjung Pinang|ID|0.92|104.46
Hougang New Town|SG|1.36|103.89
Baton Rouge|US|30.44|-91.19
Criciúma|BR|-28.68|-49.37
Sosnowiec|PL|50.29|19.1
Diez de Octubre|CU|23.09|-82.36
Turkistan|KZ|43.29|68.26
Klerksdorp|ZA|-26.85|26.67
Upper West Side|US|40.79|-73.98
Staryy Oskol|RU|51.3|37.85
Ageo|JP|35.97|139.61
Gusau|NG|12.17|6.66
Neue Neustadt|DE|52.15|11.63
Kamyanske|UA|48.52|34.61
Ashdod|IL|31.79|34.65
Radom|PL|51.4|21.15
Paya Terubong|MY|5.37|100.28
Richmond|US|37.55|-77.46
Chang-hua|TW|24.07|120.56
Changhua|TW|24.07|120.55
Điện Bàn|VN|15.89|108.25
Takarazuka|JP|34.8|135.36
Nzérékoré|GN|7.76|-8.82
Regina|CA|50.45|-104.62
Cà Mau|VN|9.18|105.15
Shrīrāmpur|IN|22.75|88.34
Fendou|CN|46.64|124.86
Pangkalpinang|ID|-2.13|106.11
Huanggang|CN|23.68|117
Quthbullapur|IN|17.5|78.46
Mubi|NG|10.27|13.27
Varāmīn|IR|35.32|51.65
Sector 1|RO|44.49|26.05
Batu|ID|-7.87|112.53
Somerset West|ZA|-34.08|18.82
Luton|GB|51.88|-0.42
Ternopil|UA|49.55|25.59
Bitung|ID|1.44|125.13
Mymensingh|BD|24.76|90.41
Blagoveshchensk|RU|50.28|127.53
Nadiād|IN|22.69|72.86
Kumba|CM|4.64|9.45
Košice|SK|48.71|21.26
Kremenchuk|UA|49.06|33.4
Jingling|CN|30.65|113.1
Nāgercoil|IN|8.18|77.43
Sucre|BO|-19.03|-65.26
Mutare|ZW|-18.97|32.67
Ōta|JP|36.3|139.37
Karāwalnagar|IN|28.73|77.27
Puerto Vallarta|MX|20.62|-105.23
Minamirinkan|JP|35.5|139.44
Cork|IE|51.9|-8.47
Atsugi|JP|35.44|139.37
Heihe|CN|50.24|127.49
Mango|IN|22.83|86.22
Sinop|BR|-11.86|-55.5
Paramaribo|SR|5.87|-55.17
Klungkung|ID|-8.53|115.4
Narayanganj|BD|23.61|90.5
NIA Valencia|PH|7.91|125.09
Tongchuanshi|CN|35.07|109.08
Concepción|CL|-36.83|-73.05
Ramadi|IQ|33.42|43.31
Paradise|US|36.1|-115.15
Tacoma|US|47.25|-122.44
Mainz|DE|49.98|8.28
Velikiy Novgorod|RU|58.52|31.27
Sungai Buloh|MY|3.21|101.56
Puerto Princesa|PH|9.74|118.74
Palhoça|BR|-27.65|-48.67
Xintai|CN|35.9|117.75
El Tigre|VE|8.89|-64.25
Haeju|KP|38.04|125.71
Formosa|AR|-26.18|-58.17
Ikire|NG|7.37|4.19
Jiexiu|CN|37.02|111.91
La Ceiba|HN|15.76|-86.78
Tilburg|NL|51.56|5.09
Ba Dinh|VN|21.04|105.83
Murwāra|IN|23.84|80.39
Moshi|TZ|-3.35|37.33
Kanchipuram|IN|12.84|79.7
Sousse|TN|35.83|10.64
Tuluá|CO|4.08|-76.2
Soyo|AO|-6.13|12.37
Sóc Trăng|VN|9.6|105.97
Kankan|GN|10.39|-9.31
Shakhty|RU|47.72|40.22
Mbarara|UG|-0.6|30.65
Luziânia|BR|-16.25|-47.95
Olongapo|PH|14.83|120.28
Ibarra|EC|0.35|-78.12
Banja Luka|BA|44.78|17.21
Rufisque est|SN|14.72|-17.27
Neyshābūr|IR|36.21|58.8
Sāveh|IR|35.02|50.36
Wuxue|CN|29.85|115.55
Shevchenkivskyi|UA|50.02|36.22
Chí Linh|VN|21.07|106.32
Campeche|MX|19.84|-90.52
Quận Ba|VN|10.77|106.69
Singrauli|IN|24.2|82.68
Fuencarral-El Pardo|ES|40.5|-3.73
Shevchenkivskyi|UA|50.46|30.47
Mirzāpur|IN|25.14|82.57
Oviedo|ES|43.36|-5.84
Bandar Seri Alam|MY|1.5|103.88
Sorong|ID|-0.88|131.26
Messina|IT|38.19|15.55
Dehiwala-Mount Lavinia|LK|6.84|79.87
Kropyvnytskyi|UA|48.51|32.27
Kharagpur|IN|22.34|87.33
Kabinda|CD|-6.14|24.48
Jacobabad|PK|28.28|68.44
Tunduma|TZ|-9.3|32.77
Binangonan|PH|14.46|121.19
Oberhausen|DE|51.48|6.86
Chon Buri|TH|13.36|100.98
Santa Luzia|BR|-19.77|-43.85
Prokop’yevsk|RU|53.92|86.72
Samambaia|BR|-15.88|-48.1
Erfurt|DE|50.98|11.04
Esmeraldas|EC|0.96|-79.65
Terrassa|ES|41.57|2.02
Barking|GB|51.53|0.08
Wuhai|CN|39.68|106.82
Valparaíso de Goiás|BR|-16.07|-47.98
Khuzdar|PK|27.81|66.61
Koutiala|ML|12.39|-5.47
Eluru|IN|16.71|81.1
Rāniganj|IN|17.43|78.49
San Pedro de Macorís|DO|18.45|-69.31
Galaţi|RO|45.44|28.05
Badalona|ES|41.45|2.25
Mokotów|PL|52.19|21.03
Taiping|MY|4.85|100.73
Yintai|CN|35.12|109.1
Yamuna Nagar|IN|30.13|77.28
Cabo de Santo Agostinho|BR|-8.29|-35.03
Arakawa|JP|35.74|139.78
Jamaica|US|40.69|-73.81
Buenavista|MX|19.61|-99.17
Gilgit|PK|35.92|74.31
Rybinsk|RU|58.05|38.84
Santa Rosa|PH|14.31|121.11
Sobral|BR|-3.69|-40.35
Trondheim|NO|63.43|10.4
Raurkela Industrial Township|IN|22.2|84.86
Porlamar|VE|10.96|-63.87
San Bernardino|US|34.11|-117.29
Ciudad Acuña|MX|29.32|-100.95
Oulu|FI|65.01|25.47
Bidar|IN|17.91|77.52
Vykhino-Zhulebino|RU|55.7|37.81
Lutsk|UA|50.76|25.35
La Ceiba|HN|15.77|-86.83
San Cristóbal de las Casas|MX|16.73|-92.64
Zelenograd|RU|55.98|37.18
Archway|GB|51.57|-0.13
Wangsa Maju|MY|3.2|101.74
Salt Lake City|US|40.76|-111.89
Biysk|RU|52.53|85.2
Novi Sad|RS|45.25|19.84
Jinzhou|CN|39.1|121.72
Jiutepec|MX|18.88|-99.18
Longgang|CN|22.72|114.26
Monclova|MX|26.91|-101.42
Tân An|VN|10.54|106.41
Ma On Shan|HK|22.41|114.24
Commonwealth|PH|14.7|121.08
Huntsville|US|34.73|-86.59
Jabaquara|BR|-23.65|-46.65
Ziguinchor|SN|12.57|-16.27
Passo Fundo|BR|-28.26|-52.41
Kŭlob|TJ|37.91|69.78
Citeureup|ID|-6.49|106.88
Centralniy|RU|59.93|30.36
Sa Dec|VN|10.29|105.76
Kure|JP|34.23|132.57
Shagamu|NG|6.85|3.65
Bnei Brak|IL|32.08|34.83
Khouribga|MA|32.88|-6.91
Yingtan|CN|28.23|117
Des Moines|US|41.6|-93.61
Çiğli|TR|38.5|27.07
Marcory|CI|5.31|-3.99
Gojra|PK|31.15|72.68
Cartagena|ES|37.6|-0.98
Quevedo|EC|-1.03|-79.46
Oakville|CA|43.45|-79.68
Pasuruan|ID|-7.65|112.91
Naz̧arābād|IR|35.95|50.61
Munger|IN|25.37|86.47
Xilin Hot|CN|43.97|116.03
Jerez de la Frontera|ES|36.69|-6.14
El Jadida|MA|33.26|-8.51
Zitong|CN|30.18|105.83
Loa Janan|ID|-0.58|117.1
Târgu Mureş|RO|46.54|24.56
Fontana|US|34.09|-117.44
Rancagua|CL|-34.17|-70.74
Zhubei|TW|24.84|121.01
Mallawī|EG|27.73|30.84
Cape Coast|GH|5.11|-1.25
Bukit Mertajam|MY|5.36|100.47
Lipa City|PH|13.94|121.16
Lanús|AR|-34.71|-58.39
Lübeck|DE|53.87|10.69
Luojiang|CN|31.3|104.5
Sepang|MY|2.69|101.75
Cobán|GT|15.47|-90.37
Maricá|BR|-22.92|-42.82
Cao Lãnh|VN|10.46|105.63
Isesaki|JP|36.32|139.2
Sabadell|ES|41.54|2.11
Jaraguá|BR|-23.44|-46.74
Taito|JP|35.71|139.78
Nandyāl|IN|15.48|78.48
Santa Cruz de Tenerife|ES|28.47|-16.25
Panchkula|IN|30.69|76.85
Modesto|US|37.64|-121
Panabo|PH|7.31|125.68
Lijiang|CN|26.87|100.22
Konibodom|TJ|40.29|70.43
Hailar|CN|49.2|119.7
Itaquera|BR|-23.53|-46.44
Kabankalan|PH|9.98|122.81
Burhānpur|IN|21.31|76.23
Abha|SA|18.22|42.51
Ternate|ID|0.79|127.38
Burgas|BG|42.51|27.47
Pskov|RU|57.82|28.33
Morvi|IN|22.82|70.84
Daliang|CN|22.84|113.25
Quilicura|CL|-33.37|-70.71
Beni Mellal|MA|32.34|-6.35
Ashuganj City|BD|24.04|91.01
Sidi Bel Abbes|DZ|35.19|-0.63
Arroyo Naranjo|CU|23.04|-82.38
Jebel Ali|AE|25|55.11
Bogra|BD|24.85|89.37
Kostanay|KZ|53.21|63.62
Richmond|CA|49.17|-123.14
Rochester|US|43.15|-77.62
Banjar|ID|-7.2|107.43
Novi Beograd|RS|44.81|20.42
Kanggye|KP|40.97|126.59
Chungju|KR|36.98|127.93
Anand|IN|22.55|72.96
São Leopoldo|BR|-29.76|-51.15
Bade|TW|24.93|121.28
Oruro|BO|-17.97|-67.09
Bachuan|CN|29.85|106.05
La Romana|DO|18.42|-68.97
Araçatuba|BR|-21.21|-50.43
Shashamane|ET|7.2|38.6
Hangu|CN|39.25|117.79
Ongole|IN|15.5|80.04
Pamplona|ES|42.82|-1.64
Maryvale|US|33.5|-112.18
Gangneung|KR|37.75|128.87
Portsmouth|GB|50.8|-1.09
Gandajika|CD|-6.75|23.95
Gunan|CN|29.02|106.65
Phan Rang-Tháp Chàm|VN|11.56|108.99
Ciputat|ID|-6.24|106.7
Kasangati|UG|0.44|32.6
Arlington|US|38.88|-77.1
Bishoftu|ET|8.75|38.98
Nishi-Tokyo-shi|JP|35.73|139.54
Changam-ch’on|KP|40.61|128.78
Bila Tserkva|UA|49.8|30.12
Oxnard|US|34.2|-119.18
Ciampea|ID|-6.55|106.7
Hurghada|EG|27.26|33.81
Móstoles|ES|40.32|-3.86
Columbus|US|32.46|-84.99
Mantilla|CU|23.07|-82.34
Dosquebradas|CO|4.84|-75.67
Toledo|PH|10.38|123.64
Turku|FI|60.45|22.27
Worcester|US|42.26|-71.8
Pagadian|PH|7.83|123.44
Epworth|ZW|-17.89|31.15
San Felipe|VE|10.34|-68.74
Dinajpur|BD|25.63|88.64
Hosapete|IN|15.27|76.39
Việt Yên|VN|21.27|106.13
Ifakara|TZ|-8.13|36.68
Sumbe|AO|-11.21|13.84
Ségou|ML|13.44|-6.26
Kon Tum|VN|14.35|108.01
Latacunga|EC|-0.93|-78.62
Nāngloi Jāt|IN|28.68|77.07
Kishiwada|JP|34.47|135.37
Yunjinghong|CN|22.01|100.8
Mdantsane|ZA|-32.93|27.78
Bobruysk|BY|53.15|29.21
Gorontalo|ID|0.54|123.06
Itaim Paulista|BR|-23.5|-46.39
Qā’em Shahr|IR|36.47|52.87
Shikarpur|PK|27.96|68.64
Gongheyong|CN|22.76|113.79
Linz|AT|48.31|14.29
Dhangaḍhi̇̄|NP|28.7|80.59
Nanchuan|CN|29.15|107.1
Córdoba|MX|18.88|-96.93
Bishan|CN|29.59|106.22
Biskra|DZ|34.85|5.73
Xizhi|TW|25.07|121.66
Yanghang|CN|31.37|121.44
Gaoping|CN|30.78|106.1
Trieste|IT|45.65|13.78
Mpanda|TZ|-6.34|31.07
Moreno Valley|US|33.94|-117.23
Secunderabad|IN|17.5|78.54
Punggol|SG|1.41|103.91
Sodo|ET|6.86|37.76
Nossa Senhora do Socorro|BR|-10.85|-37.13
Zliten|LY|32.47|14.57
Padua|IT|45.41|11.89
Karnaphuli|BD|22.69|92.23
Las Tunas|CU|20.96|-76.95
Matsue|JP|35.48|133.05
Bayamón|PR|18.4|-66.16
Gimpo-si|KR|37.62|126.71
Lauro de Freitas|BR|-12.89|-38.33
Deoghar|IN|24.49|86.7
Fianarantsoa|MG|-21.45|47.09
Vasyl'evsky Ostrov|RU|59.94|30.25
Chāndpur|BD|23.23|90.65
Atsiaman|GH|5.7|-0.33
Bandundu Province|CD|-3.32|17.38
Osmaniye|TR|37.07|36.25
Bābol|IR|36.55|52.68
Cabo San Lucas|MX|22.89|-109.91
Little Rock|US|34.75|-92.29
Çorlu|TR|41.16|27.8
Madiun|ID|-7.63|111.52
Iringa|TZ|-7.77|35.7
Debrecen|HU|47.53|21.62
Chāpra|IN|25.78|84.75
Motijheel|BD|23.73|90.42
Barishal|BD|22.7|90.37
Richmond Hill|CA|43.87|-79.44
Fayetteville|US|35.05|-78.88
Al Khums|LY|32.65|14.26
Huntington Beach|US|33.66|-118
Favoriten|AT|48.16|16.38
Koronadal|PH|6.5|124.85
Geneva|CH|46.2|6.15
Tallahassee|US|30.44|-84.28
Swindon|GB|51.56|-1.78
Rengasdengklok|ID|-6.16|107.3
Rio Claro|BR|-22.41|-47.56
Cajamarca|PE|-7.16|-78.5
Townsville|AU|-19.27|146.81
Thanh Khê|VN|16.07|108.19
La Pintana|CL|-33.58|-70.63
Daşoguz|TM|41.84|59.97
Yonkers|US|40.93|-73.9
Glendale|US|34.14|-118.26
Dadu|PK|26.73|67.78
Arba Minch|ET|6.03|37.55
Petropavl|KZ|54.87|69.15
Lhokseumawe|ID|5.18|97.15
Cypress|US|29.97|-95.7
Khandwa|IN|21.82|76.35
Aurora|US|41.76|-88.32
Puri|IN|19.8|85.82
Morena|IN|26.5|78
Nicosia|CY|35.17|33.35
Brescia|IT|45.54|10.21
Nasīm Shahr|IR|35.57|51.16
Nasimshahr|IR|35.57|51.16
Ugep|NG|5.81|8.08
Kamina|CD|-8.74|25
Yanbu|SA|24.09|38.06
Nagareyama|JP|35.86|139.9
Charleroi|BE|50.41|4.44
Lạng Sơn|VN|21.85|106.76
Talhar|PK|24.88|68.81
São José|BR|-28.21|-49.16
Nyingchi|CN|29.65|94.36
Yuen Long San Hui|HK|22.43|114.03
Yuen Long|HK|22.45|114.03
Sumedang|ID|-6.86|107.92
Gyānpur|IN|25.33|82.47
Az Zāwīyah|LY|32.76|12.73
Salé Al Jadida|MA|34|-6.74
Bandar Sunway|MY|3.07|101.61
Bandar Utama|MY|3.15|101.61
Bukit Jalil|MY|3.05|101.68
Chakwama|NG|11.56|9.66
Qadirpur Ran|PK|30.29|71.67
Dajal|PK|29.56|70.38
Severnyy|RU|55.94|37.55
El Dibir|SO|11.77|51.22
Beiliu|CN|22.71|110.35
Sirjan|IR|29.45|55.68
Iquique|CL|-20.21|-70.15
Thuận Thanh|VN|21.05|106.08
Balakovo|RU|52.03|47.8
Armavir|RU|45|41.11
Jaraguá do Sul|BR|-26.49|-49.07
Yachiyo|JP|35.74|140.12
Saidpur|BD|25.78|88.89
Quận Bốn|VN|10.77|106.71
Arīsh|EG|31.13|33.8
Rawang|MY|3.32|101.58
Dudley|GB|52.5|-2.08
Mushin|NG|6.53|3.35
Yuzhno-Sakhalinsk|RU|46.95|142.74
Hagen|DE|51.36|7.47
Salatiga|ID|-7.33|110.49
Rio Grande|BR|-32.03|-52.1
Guacara|VE|10.23|-67.88
Khūy|IR|38.55|44.95
Gliwice|PL|50.3|18.68
Changji|CN|44.01|87.3
Kodaira|JP|35.73|139.49
Plano Piloto|BR|-15.79|-47.88
Amarillo|US|35.22|-101.83
Bulandshahr|IN|28.4|77.86
Lusail|QA|25.42|51.51
Aberdeen|GB|57.14|-2.1
Taranto|IT|40.46|17.25
Capiatá|PY|-25.36|-57.45
Zango|AO|-9.01|13.38
Duyun|CN|26.27|107.52
Naivasha|KE|-0.71|36.43
Kaiyuan|CN|23.7|103.3
Cachoeiro de Itapemirim|BR|-20.85|-41.11
Rzeszów|PL|50.04|22
Lengshuijiang|CN|27.69|111.43
Rostock|DE|54.09|12.14
Parma|IT|44.8|10.33
Sibu|MY|2.3|111.82
Arnavutköy|TR|41.18|28.74
Itami|JP|34.78|135.4
Mentougou|CN|39.94|116.09
Bhind|IN|26.57|78.79
Akron|US|41.08|-81.52
Talca|CL|-35.42|-71.65
Kassel|DE|51.32|9.5
Ciudad Madero|MX|22.25|-97.84
Sawangan|ID|-6.4|106.77
Gemena|CD|3.26|19.77
Bhālswa Jahangirpur|IN|28.74|77.17
Lushui|CN|25.82|98.86
Bīrjand|IR|32.87|59.22
Toruń|PL|53.01|18.6
Almería|ES|36.84|-2.46
Jijiang|CN|29.29|106.25
Ahmadpur East|PK|29.14|71.26
Huánuco|PE|-9.93|-76.24
Higashihiroshima|JP|34.41|132.74
İzmit|TR|40.76|29.93
Reims|FR|49.27|4.03
Hanfeng|CN|31.17|108.4
Vancouver|US|45.64|-122.66
Birmingham|US|33.52|-86.8
Itabuna|BR|-14.79|-39.28
Laayoune|EH|27.14|-13.19
Khammam|IN|17.25|80.14
H̱olon|IL|32.01|34.78
Middelburg|ZA|-25.78|29.46
Icheon-si|KR|37.28|127.44
Khirdalan|AZ|40.45|49.76
Phra Pradaeng|TH|13.66|100.53
Moundou|TD|8.57|16.08
Sambhal|IN|28.58|78.57
Bhiwāni|IN|28.79|76.14
Engels|RU|51.48|46.11
Ciudad Lázaro Cárdenas|MX|17.96|-102.2
Mocuba|MZ|-16.84|36.99
Hetauda|NP|27.43|85.03
Durrës|AL|41.32|19.45
Fengcheng|CN|40.45|124.07
Suzuka|JP|34.88|136.58
Hub|PK|25.03|66.89
La Plata|AR|-34.92|-57.95
Janakpur|NP|26.73|85.93
Kamirenjaku|JP|35.69|139.55
Panvel|IN|18.99|73.11
Peicheng|CN|34.74|116.92
Maharagama|LK|6.85|79.93
Montgomery|US|32.37|-86.3
Liège|BE|50.63|5.57
Kumagaya|JP|36.13|139.39
Guri-si|KR|37.6|127.14
Ambāla|IN|30.36|76.8
Grand Rapids|US|42.96|-85.67
Prato|IT|43.88|11.1
Kumarapalayam|IN|11.44|77.71
Butwāl|NP|27.69|83.45
Dhirkot|PK|34.04|73.58
Kayes|ML|14.45|-11.44
Bontang|ID|0.13|117.49
Kafr ash Shaykh|EG|31.11|30.94
Tébessa|DZ|35.4|8.12
Kuala Kubu Baharu|MY|3.56|101.66
Karuri|KE|-1.18|36.76
Karuri|KE|-0.7|37.18
Manéah|GN|9.73|-13.42
Severodvinsk|RU|64.56|39.83
Kowloon City Centre|HK|22.33|114.19
Matuga|KE|-4.17|39.57
Düzce|TR|40.84|31.16
Nnewi|NG|6.02|6.92
Yamaguchi|JP|34.18|131.47
Alcalá de Henares|ES|40.48|-3.36
Başakşehir|TR|41.11|28.79
Ezhou|CN|30.4|114.83
Zhengding|CN|38.15|114.57
Būkān|IR|36.52|46.21
Taguatinga|BR|-15.83|-48.06
Braga|PT|41.55|-8.42
Garhi Khairo|PK|28.06|67.98
Luanshya|ZM|-13.14|28.42
Padalarang|ID|-6.84|107.47
Bang Khae|TH|13.69|100.41
Bago City|PH|10.53|122.83
Yongchuan|CN|29.35|105.89
Uji|JP|34.89|135.8
Machilīpatnam|IN|16.19|81.14
Hepu|CN|21.66|109.2
Aihui|CN|49.98|127.48
Hyesan|KP|41.4|128.18
Bayamo|CU|20.37|-76.64
Kielce|PL|50.87|20.63
Pār Naogaon|BD|24.8|88.95
Fuding|CN|27.33|120.21
Castanhal|BR|-1.29|-47.93
Cidade Tiradentes|BR|-23.58|-46.4
Zabrze|PL|50.32|18.79
Hamilton|NZ|-37.78|175.28
Bojnūrd|IR|37.47|57.33
Surulere|NG|6.5|3.36
Humen|CN|22.82|113.67
Benfica|AO|-8.94|13.16
Hat Yai|TH|7.01|100.48
Haicheng|CN|40.85|122.75
Curug|ID|-6.27|106.56
Barrancabermeja|CO|7.07|-73.85
Zlatoust|RU|55.17|59.65
Mukono|UG|0.35|32.76
Angren|UZ|41.02|70.14
Ciudad del Carmen|MX|18.65|-91.83
Khairpur Mir’s|PK|27.53|68.76
Business Bay|AE|25.19|55.27
Khujand|TJ|40.28|69.62
Peoria|US|33.58|-112.24
Ashaiman|GH|5.7|-0.03
Tanjungbalai|ID|2.97|99.8
Providence|US|41.82|-71.41
Mahesāna|IN|23.6|72.38
Knoxville|US|35.96|-83.92
Rangel|AO|-8.83|13.26
Fuenlabrada|ES|40.28|-3.79
Hino|JP|35.67|139.4
Jhelum|PK|32.93|73.73
Mahbūbnagar|IN|16.74|77.99
Beipiao|CN|41.79|120.78
Pak Kret|TH|13.91|100.5
Cẩm Phả|VN|21.01|107.27
Al Fallūjah|IQ|33.35|43.79
Jinshanlu|CN|47.85|88.13
Ise-Ekiti|NG|7.46|5.42
Nova Friburgo|BR|-22.28|-42.53
Guarapuava|BR|-25.39|-51.47
Kofu|JP|35.67|138.57
Numazu|JP|35.1|138.87
Santa Bárbara d'Oeste|BR|-22.75|-47.41
Jōetsu|JP|37.15|138.24
Planaltina|BR|-15.62|-47.65
Sunrise Manor|US|36.21|-115.07
Sambalpur|IN|21.47|83.98
Syzran|RU|53.16|48.47
Danshui|TW|25.17|121.44
Bytom|PL|50.35|18.93
Mwene-Ditu|CD|-7.01|23.45
Ilhéus|BR|-14.8|-39.03
Panalanoy|PH|11.25|125.01
Ciudad de Las Heras|AR|-32.85|-68.84
Guixi|CN|30.33|107.35
Odawara|JP|35.26|139.16
Labuan Bajo|ID|-8.5|119.89
Anjō|JP|34.96|137.08
Boyeros|CU|23.01|-82.4
George|ZA|-33.96|22.46
Tottori-shi|JP|35.5|134.23
Leganés|ES|40.33|-3.76
Acarigua|VE|9.55|-69.2
Hosa’ina|ET|7.55|37.85
Sai Mai|TH|13.92|100.65
Yawnghwe|MM|20.66|96.93
Mabalacat City|PH|15.22|120.57
Riohacha|CO|11.54|-72.91
Laizhou|CN|37.18|119.94
Pilsen|CZ|49.75|13.38
Grand Prairie|US|32.75|-97
Sorsogon|PH|12.97|123.99
Ait Melloul|MA|30.34|-9.5
Sutton|GB|51.35|-0.2
Shreveport|US|32.53|-93.75
Choa Chu Kang New Town|SG|1.38|103.75
Getafe|ES|40.31|-3.73
Quận Năm|VN|10.76|106.67
Bhusawal|IN|21.04|75.79
Miraflores|PE|-12.11|-77.03
Alvorada|BR|-30|-51.08
Chilpancingo|MX|17.55|-99.5
Donaustadt|AT|48.23|16.46
Pinar del Río|CU|22.42|-83.7
Huixing|CN|29.68|106.61
Kırıkkale|TR|39.85|33.51
Batumi|GE|41.64|41.63
Burlington|CA|43.39|-79.84
Pābna|BD|24.01|89.24
Brownsville|US|25.9|-97.5
Changyuan|CN|29.4|105.59
Cienfuegos|CU|22.15|-80.45
Beersheba|IL|31.25|34.79
Dixinn|GN|9.55|-13.67
El Oued|DZ|33.36|6.86
Overland Park|US|38.98|-94.67
Raebareli|IN|26.23|81.23
Shangri-La|CN|27.83|99.71
Springs|ZA|-26.25|28.4
Newport News|US|36.98|-76.43
Yangcheng|CN|30|106.26
Mopti|ML|14.48|-4.18
Khuraybat as Sūq|JO|31.88|35.92
Zawiya|LY|32.75|12.73
Zamora de Hidalgo|MX|19.98|-102.29
Haridwar|IN|29.95|78.16
Ad-Damazin|SD|11.79|34.36
Dunhuang|CN|40.17|94.68
Jing’an|CN|22.21|113.29
Le Havre|FR|49.49|0.11
Verhunskyi|UA|48.59|39.37
Phusro|IN|23.76|86.01
Donostia / San Sebastián|ES|43.31|-1.97
Poza Rica de Hidalgo|MX|20.53|-97.46
Bilbeis|EG|30.42|31.56
Roxas City|PH|11.59|122.75
Paris 20 Ménilmontant|FR|48.86|2.4
Kütahya|TR|39.42|29.98
Palopo|ID|-2.99|120.2
Potsdam|DE|52.4|13.07
Modena|IT|44.65|10.93
Bolu|TR|40.74|31.61
Toyokawa|JP|34.82|137.4
Adoni|IN|15.63|77.27
Izumi|JP|34.48|135.43
Santa Anita - Los Ficus|PE|-12.05|-76.97
Paltan|BD|23.74|90.41
Ivory Park|ZA|-26|28.19
Al Qāmishlī|SY|37.05|41.23
Abakan|RU|53.72|91.43
Pemalang|ID|-6.89|109.38
Breda|NL|51.59|4.78
Langsa|ID|4.47|97.97
Vĩnh Châu|VN|9.32|105.98
Baishan|CN|41.94|126.42
Sūjāngarh|IN|27.7|74.47
Linhares|BR|-19.39|-40.07
Castelló de la Plana|ES|39.99|-0.05
Tachikawa|JP|35.71|139.42
Cergy-Pontoise|FR|49.04|2.08
Unaizah|SA|26.1|44
Mobile|US|30.69|-88.04
St Helens|GB|53.45|-2.73
Fort Lauderdale|US|26.12|-80.14
Lembang|ID|-6.81|107.62
Paris 18 Buttes-Montmartre|FR|48.89|2.34
Sants-Montjuïc|ES|41.37|2.15
Oradea|RO|47.05|21.92
Araguaína|BR|-7.19|-48.21
Saarbrücken|DE|49.23|7.01
Bunda|TZ|-2.02|33.87
Skikda|DZ|36.88|6.91
Kyivskyi|UA|50.04|36.29
Tirmiz|UZ|37.22|67.28
Singosari|ID|-7.89|112.67
Porto Seguro|BR|-16.45|-39.06
Cúa|VE|10.16|-66.88
Sirsa|IN|29.53|75.03
Kamensk-Ural’skiy|RU|56.41|61.93
Cidade Dutra|BR|-23.73|-46.7
Reggio Calabria|IT|38.11|15.66
Dinapur Nizamat|IN|25.64|85.05
Santa Clarita|US|34.39|-118.54
Carletonville|ZA|-26.36|27.4
Dubréka|GN|9.79|-13.52
Metro|ID|-5.11|105.31
Banhā|EG|30.46|31.18
Bahraigh|IN|27.57|81.59
Ash Shaţrah|IQ|31.41|46.17
Quarto Oggiaro|IT|45.51|9.14
Tsing Yi Town|HK|22.35|114.1
Monywa|MM|22.11|95.14
Dessalines|HT|19.26|-72.52
Mwala|KE|-1.35|37.45
Kāraikkudi|IN|10.07|78.77
Araure|VE|9.58|-69.24
Barra Mansa|BR|-22.54|-44.17
Sultan Pur Majra|IN|28.69|77.08
Zhenping|CN|33.03|112.23
Anda|CN|46.45|125.3
Paris 13 Gobelins|FR|48.83|2.36
Petropavlovsk-Kamchatsky|RU|53.06|158.63
Wādī as Sīr|JO|31.95|35.82
Fardīs|IR|35.76|51
Chattanooga|US|35.05|-85.31
Guna|IN|24.65|77.31
Odense|DK|55.4|10.39
Sacaba|BO|-17.4|-66.04
Quetzaltenango|GT|14.84|-91.52
Gongzhuling|CN|43.5|124.82
Chandannagar|IN|22.86|88.37
Baharampur|IN|24.1|88.25
Ploieşti|RO|44.95|26.02
Berazategui|AR|-34.77|-58.21
Shahuwadi|IN|16.91|73.95
Madanapalle|IN|13.55|78.5
Tangail|BD|24.25|89.92
Shulin|TW|24.99|121.42
Edirne|TR|41.68|26.56
Nepean|CA|45.34|-75.72
Pingwu County|CN|32.41|104.53
Kyaukpyu|MM|19.43|93.55
Yasenevo|RU|55.61|37.52
Phúc Yên|VN|21.24|105.7
Shivpuri|IN|25.42|77.66
Yangju|KR|37.83|127.06
Borshchahivka|UA|50.43|30.39
Praga Południe|PL|52.24|21.09
Pirituba|BR|-23.49|-46.73
Kasama|ZM|-10.21|31.18
Surendranagar|IN|22.73|71.65
Alexandra|ZA|-26.11|28.1
Obuase|GH|6.2|-1.67
Desnyanskyi|UA|51.51|31.32
Novozavodskyi|UA|51.49|31.26
Ibirité|BR|-20.02|-44.06
Tsentralnyi|UA|47.1|37.55
Legaspi|PH|13.14|123.74
Phú Quốc|VN|10.29|104.01
Podolsk|RU|55.42|37.55
Purwakarta|ID|-6.56|107.44
Jizzax|UZ|40.13|67.83
Ferraz de Vasconcelos|BR|-23.54|-46.37
Ila Orangun|NG|8.02|4.9
Thị Trấn Đại Từ|VN|21.63|105.64
Neyveli|IN|11.61|79.5
Angra dos Reis|BR|-23.01|-44.32
Qianjiang|CN|30.42|112.89
Hamm|DE|51.68|7.82
Si Racha|TH|13.17|100.93
Tiaret|DZ|35.37|1.32
La Rioja|AR|-29.41|-66.86
Silchar|IN|24.83|92.8
Amadora|PT|38.75|-9.23
Cuautitlán|MX|19.67|-99.18
Ipswich|GB|52.06|1.16
Njeru|UG|0.44|33.18
Toliara|MG|-23.35|43.67
Paris 19 Buttes-Chaumont|FR|48.88|2.38
Saki|NG|8.67|3.39
Chlef|DZ|36.17|1.33
Fontanar|CU|23.02|-82.41
Seogwipo|KR|33.25|126.56
Concepcion|PH|15.33|120.66
East Flatbush|US|40.65|-73.93
Spring Valley|US|36.11|-115.24
Livingstone|ZM|-17.84|25.85
Potchefstroom|ZA|-26.72|27.1
Santa Rosa|US|38.44|-122.71
Ciudad Camilo Cienfuegos|CU|23.16|-82.33
Paris 13e Arrondissement|FR|48.83|2.36
Sambizanga|AO|-8.79|13.28
Proddatūr|IN|14.75|78.55
Sittwe|MM|20.15|92.9
Dundo|AO|-7.37|20.82
Basel|CH|47.56|7.57
Meiktila|MM|20.88|95.86
Gulu|UG|2.77|32.3
Nijmegen|NL|51.84|5.85
Idkū|EG|31.31|30.3
Uppsala|SE|59.86|17.64
Hugli|IN|22.91|88.4
Hashtsāl|IN|28.63|77.06
Bragança Paulista|BR|-22.95|-46.54
Teresópolis|BR|-22.42|-42.98
San Luis Río Colorado|MX|32.46|-114.77
Santa Ana|SV|13.99|-89.56
Eugene|US|44.05|-123.09
Nador|MA|35.17|-2.93
Al Muharraq|BH|26.26|50.61
Bielsko-Biala|PL|49.82|19.05
Marsá Maţrūḩ|EG|31.35|27.24
Almere Stad|NL|52.37|5.21
Burgos|ES|42.34|-3.7
Gijang|KR|35.24|129.21
Lander|VE|10.18|-66.7
Saint-Étienne|FR|45.43|4.39
Amroha|IN|28.9|78.47
Narashino|JP|35.68|140.04
Béjaïa|DZ|36.76|5.08
Zhenzhou|CN|32.28|119.17
Tempe|US|33.41|-111.91
Xindi|CN|29.82|113.47
Oceanside|US|33.2|-117.38
Bella Vista|DO|18.46|-69.95
Fengcheng|CN|29.83|107.06
Salem|US|44.94|-123.04
Wigan|GB|53.54|-2.64
Garden Grove|US|33.77|-117.94
Karaman|TR|37.18|33.22
Oshawa|CA|43.9|-78.85
Siverek|TR|37.76|39.32
Rancho Cucamonga|US|34.11|-117.59
Cape Coral|US|26.56|-81.95
Tân Châu|VN|10.8|105.24
Teluknaga|ID|-6.1|106.64
Jiutai|CN|44.15|125.83
Chhindwāra|IN|22.06|78.94
Itu|BR|-23.26|-47.3
Senador Canedo|BR|-16.71|-49.09
Khānaqīn|IQ|34.35|45.39
Naga|PH|13.62|123.18
Tomakomai|JP|42.64|141.6
Tambaram|IN|12.92|80.13
San Miguel de Allende|MX|20.92|-100.74
Cianjur|ID|-6.82|107.14
Pamulang|ID|-6.34|106.74
Hitachi|JP|36.6|140.65
Timon|BR|-5.09|-42.84
Bhetia|IN|22.79|86.14
Pathānkot|IN|32.27|75.65
Tando Adam|PK|25.77|68.66
Badlapur|IN|19.16|73.27
Cikupa|ID|-6.24|106.51
Puerto Cabello|VE|10.47|-68.01
Latkrabang|TH|13.73|100.75
Sakura|JP|35.72|140.23
Ube|JP|33.94|131.25
Daule|EC|-1.86|-79.98
Bayjī|IQ|34.93|43.49
Cuddalore|IN|11.76|79.77
Santander|ES|43.47|-3.8
Tlemcen|DZ|34.88|-1.31
Shimla|IN|31.1|77.17
Shāhīn Shahr|IR|32.86|51.55
Croydon|GB|51.38|-0.1
Myeik|MM|12.44|98.6
East New York|US|40.67|-73.88
Khān Yūnis|PS|31.34|34.31
Dharān|NP|26.81|87.28
Mülheim|DE|51.43|6.88
Albacete|ES|38.99|-1.86
Bata|GQ|1.86|9.77
Kamakura|JP|35.31|139.55
Chicoloapan|MX|19.42|-98.9
Gadag-Betageri|IN|15.42|75.62
Licheng|CN|23.3|113.82
Izumo|JP|35.37|132.77
São Caetano do Sul|BR|-23.62|-46.55
Pindamonhangaba|BR|-22.92|-45.46
Gadag|IN|15.43|75.63
Ongata Rongai|KE|-1.4|36.76
Lang'ata|KE|-1.37|36.73
Tunja|CO|5.54|-73.36
Lages|BR|-27.82|-50.33
Quillacollo|BO|-17.39|-66.28
Alcorcón|ES|40.35|-3.82
Gisenyi|RW|-1.7|29.26
Poços de Caldas|BR|-21.79|-46.56
Isparta|TR|37.76|30.55
Warrington|GB|53.39|-2.58
Klaipėda|LT|55.71|21.14
Walsall|GB|52.59|-1.98
Herne|DE|51.54|7.23
Lyublino|RU|55.68|37.76
Mansfield|GB|53.13|-1.2
Reggio nell'Emilia|IT|44.7|10.63
Barreiras|BR|-12.15|-44.99
Kēng Tung|MM|21.63|99.93
Sioux Falls|US|43.54|-96.73
Prizren|XK|42.21|20.74
Dongling|CN|41.81|123.58
Ungaran|ID|-7.14|110.41
Urayasu|JP|35.66|139.9
Long Khánh|VN|10.93|107.25
Dagupan|PH|16.04|120.33
Ontario|US|34.06|-117.65
Watthana|TH|13.73|100.59
Verāval|IN|20.91|70.37
Navsari|IN|20.94|72.92
Imabari|JP|34.07|133
Mansa|ZM|-11.2|28.89
Fort Collins|US|40.59|-105.08
Bảo Lộc|VN|11.55|107.81
Kulim|MY|5.36|100.56
Oshodi|NG|6.56|3.34
Ramat Gan|IL|32.08|34.81
Bahadurgarh|IN|28.69|76.94
Haldia|IN|22.06|88.11
Temirtau|KZ|50.05|72.95
East Helsinki|FI|60.21|25.08
Parnaíba|BR|-2.9|-41.78
Carolina|PR|18.38|-65.96
Rāiganj|IN|25.61|88.12
Malāyer|IR|34.3|48.82
Springfield|US|37.22|-93.3
Sunderland|GB|54.9|-1.38
Takaoka|JP|36.75|137.02
Baranovichi|BY|53.13|26.01
Malda|IN|25|88.15
Guadalupe|MX|22.75|-102.52
Nishio|JP|34.87|137.05
San Luis|AR|-33.29|-66.32
Ouargla|DZ|31.95|5.33
Olsztyn|PL|53.78|20.49
Kipushi|CD|-11.76|27.25
Yuen Long Kau Hui|HK|22.45|114.03
Jaunpur|IN|25.75|82.69
Khlong Sam Wa|TH|13.87|100.74
Harburg|DE|53.46|9.98
Chūō|JP|35.67|139.78
Mufulira|ZM|-12.55|28.24
Deoli|IN|28.5|77.23
Jaffna|LK|9.67|80.01
Arad|RO|46.18|21.32
Chetumal|MX|18.52|-88.3
Bharūch|IN|21.69|72.98
Gurúè|MZ|-15.47|36.98
San Miguel|AR|-34.54|-58.71
Hirosaki|JP|40.59|140.47
Chalco|MX|19.26|-98.9
Toulon|FR|43.12|5.93
Vila Andrade|BR|-23.63|-46.73
Hoshiārpur|IN|31.54|75.91
Calabozo|VE|8.92|-67.43
Jabālyā|PS|31.53|34.48
Cuauhtémoc|MX|28.41|-106.87
Araraquara|BR|-21.79|-48.18
Yopal|CO|5.34|-72.39
Ituzaingó|AR|-27.59|-56.69
Piranshahr|IR|36.7|45.14
Mahābād|IR|36.76|45.72
Florencia|CO|1.62|-75.6
Tây Hồ|VN|21.07|105.81
Moratuwa|LK|6.77|79.88
Angers|FR|47.47|-0.55
Ilford|GB|51.56|0.07
Hasilpur|PK|29.69|72.55
Rio das Ostras|BR|-22.53|-41.94
Horta-Guinardó|ES|41.42|2.17
Pátra|GR|38.25|21.74
Rutchenkivskyi|UA|47.98|37.7
Đồng Xoài|VN|11.53|106.88
Jamālpur|BD|24.92|89.95
Kushiro|JP|42.98|144.37
Berezniki|RU|59.41|56.82
Awka|NG|6.21|7.07
Volgodonsk|RU|47.51|42.15
Hollywood|US|34.1|-118.33
Oyama|JP|36.3|139.8
Ijero-Ekiti|NG|7.82|5.07
Jīnd|IN|29.32|76.32
Miass|RU|55.05|60.11
Fortechnyi|UA|48.5|32.25
Tuguegarao|PH|17.62|121.72
Carúpano|VE|10.67|-63.25
Kumbakonam|IN|10.96|79.39
Plumbon|ID|-6.7|108.47
Darmstadt|DE|49.87|8.65
Mary|TM|37.59|61.83
Novocherkassk|RU|47.42|40.09
Elk Grove|US|38.41|-121.37
Mohali|IN|30.68|76.72
Sampit|ID|-2.53|112.95
Clarksville|US|36.53|-87.36
Wan Chai|HK|22.28|114.17
Linköping|SE|58.41|15.62
Iwata|JP|34.7|137.85
Kamalia|PK|30.73|72.65
Pembroke Pines|US|26|-80.22
Maicao|CO|11.38|-72.24
Obihiro|JP|42.92|143.2
Fatehpur|IN|25.93|80.81
Osnabrück|DE|52.27|8.05
Calama|CL|-22.46|-68.92
Nou Barris|ES|41.44|2.18
Nepalgunj|NP|28.05|81.62
Comitán|MX|16.24|-92.14
Ocumare del Tuy|VE|10.12|-66.78
Niiza|JP|35.82|139.56
Greater Sudbury|CA|46.49|-80.99
Khobar|SA|26.28|50.21
Songcheng|CN|26.88|120
Deer Valley|US|33.68|-112.13
Bang Khun Thian|TH|13.66|100.43
Murfreesboro|US|35.85|-86.39
Bushehr|IR|28.97|50.84
Dar Bouazza|MA|33.52|-7.82
Tonk|IN|26.17|75.79
Saqqez|IR|36.25|46.27
Béchar|DZ|31.62|-2.22
Tam Kỳ|VN|15.57|108.47
Gölbaşı|TR|39.79|32.81
Francisco Morato|BR|-23.28|-46.75
Bima|ID|-8.46|118.73
Mu-se|MM|24|97.9
Udupi|IN|13.33|74.75
Shahrud|IR|36.42|54.98
Banjaran|ID|-7.05|107.59
Thenali|IN|16.24|80.64
Mthatha|ZA|-31.59|28.78
Hengshan|CN|45.21|130.9
Slough|GB|51.51|-0.6
Bocoio|AO|-12.47|14.14
Neukölln|DE|52.48|13.43
Port Saint Lucie|US|27.29|-80.35
Sītāpur|IN|27.56|80.68
Alandur|IN|13|80.21
Zenica|BA|44.2|17.9
Lajeado|BR|-23.53|-46.41
Solingen|DE|51.17|7.08
Itapetininga|BR|-23.59|-48.05
Ðông Hà|VN|16.82|107.1
Corona|US|33.88|-117.57
Ḩawallī|KW|29.33|48.03
Musoma|TZ|-1.5|33.8
Inisa|NG|7.85|4.33
Nazran|RU|43.23|44.77
Ilagan|PH|17.15|121.89
Port-Gentil|GA|-0.72|8.78
Bhadrāvati|IN|13.85|75.71
Santana de Parnaíba|BR|-23.44|-46.92
Hadano|JP|35.37|139.22
Piraeus|GR|37.94|23.65
Vapi|IN|20.37|72.9
Bournemouth|GB|50.72|-1.88
Pedreira|BR|-23.71|-46.65
Sidon|LB|33.56|35.37
Caxias|BR|-4.86|-43.36
‘Ibrī|OM|23.23|56.52
Jomvu|KE|-3.99|39.61
Garissa|KE|-0.45|39.65
Moga|IN|30.81|75.17
Peterborough|GB|52.57|-0.25
Piedecuesta|CO|6.99|-73.05
Tongzhou|CN|39.9|116.66
Ludwigshafen am Rhein|DE|49.48|8.45
Lat Krabang|TH|13.72|100.78
Şalālah|OM|17.02|54.09
Büyükçekmece|TR|41.02|28.59
Rāj-Nāndgaon|IN|21.1|81.03
Aydın|TR|37.85|27.84
Envigado|CO|6.18|-75.59
Itapecerica da Serra|BR|-23.72|-46.85
Al-Junaynah|SD|13.45|22.45
Anbu|CN|23.45|116.68
McKinney|US|33.2|-96.62
Mostaganem|DZ|35.93|0.09
Chirchiq|UZ|41.47|69.58
Bandar-e Māhshahr|IR|30.56|49.19
Floridsdorf|AT|48.25|16.4
Leverkusen|DE|51.03|6.98
Pandi|PH|14.87|120.96
Capas|PH|15.33|120.59
Ning’er|CN|23.04|101.04
Haarlem|NL|52.38|4.64
Arnhem|NL|51.98|5.91
Nkongsamba|CM|4.95|9.94
El Vigía|VE|8.61|-71.66
Araucária|BR|-25.59|-49.41
Robertsonpet|IN|12.96|78.28
Kitale|KE|1.02|35.01
Suleja|NG|9.18|7.18
Pouso Alegre|BR|-22.23|-45.94
Taza|MA|34.21|-4.01
Oxford|GB|51.75|-1.26
Al Maţarīyah|EG|31.18|32.03
Kunduz|AF|36.73|68.86
Fengcheng|CN|34.7|116.59
Trảng Bàng|VN|11.03|106.36
Unnāo|IN|26.55|80.49
Hortaleza|ES|40.47|-3.64
N'dalatando|AO|-9.3|14.91
Budaun|IN|28.04|79.13
Ōgaki|JP|35.35|136.62
Newport|GB|51.59|-3
Coquimbo|CL|-29.95|-71.34
Baubau|ID|-5.46|122.6
Đưc Trọng|VN|11.74|108.37
Blitar|ID|-8.1|112.17
Alagoinhas|BR|-12.14|-38.42
KwaDukuza|ZA|-29.33|31.29
Miyakonojō|JP|31.73|131.07
Madhyamgram|IN|22.69|88.45
Lancaster|US|34.7|-118.14
Rubtsovsk|RU|51.51|81.21
Tacheng|CN|46.75|82.96
Kindia|GN|10.06|-12.87
Tauranga|NZ|-37.69|176.17
Kalemie|CD|-5.95|29.19
Chatuchak|TH|13.83|100.56
San Juan de los Morros|VE|9.91|-67.35
Sayama|JP|35.85|139.41
Sullana|PE|-4.9|-80.69
's-Hertogenbosch|NL|51.7|5.3
Szeged|HU|46.25|20.15
Malakal|SS|9.53|31.66
Chittoor|IN|13.21|79.1
Toledo|BR|-24.71|-53.74
Salamanca|MX|20.57|-101.2
Ban Khlong Prawet|TH|13.72|100.68
La Gi|VN|10.66|107.77
Anderlecht|BE|50.84|4.31
Mytishchi|RU|55.91|37.73
Delegación Cuajimalpa de Morelos|MX|19.37|-99.29
Hebron|PS|31.53|35.09
Camaragibe|BR|-8.02|-34.98
Mogi Guaçu|BR|-22.37|-46.95
Mejicanos|SV|13.72|-89.19
Trà Vinh|VN|9.95|106.34
Parepare|ID|-4.01|119.63
Jāmuria|IN|23.7|87.08
Koudougou|BF|12.25|-2.37
Nyzhnodniprovsk|UA|48.48|35.12
Taunggyi|MM|20.79|97.04
Dhamār|YE|14.54|44.41
Dubai Investments Park|AE|25.01|55.16
Ash Sharqāt|IQ|35.52|43.23
Dijon|FR|47.31|5.01
Salavat|RU|53.38|55.91
Ede|NG|7.74|4.44
Sukrah|TN|36.88|10.25
Manzanillo|MX|19.12|-104.34
Jalapa|GT|14.64|-89.99
Paech’ŏn-ŭp|KP|37.99|126.3
Cary|US|35.79|-78.78
Skudai|MY|1.54|103.66
Tahoua|NE|14.89|5.27
Alexandria|US|38.8|-77.05
Tuxtepec|MX|18.09|-96.13
Puthia|BD|24.37|88.83
Newton|CA|49.13|-122.85
Paris 16 Passy|FR|48.86|2.28
Zhicheng|CN|30.3|111.5
Ang Mo Kio New Town|SG|1.38|103.84
Limuru|KE|-1.11|36.64
San Miguel del Padrón|CU|23.1|-82.33
Tarija|BO|-21.54|-64.73
Patos de Minas|BR|-18.58|-46.52
Oldenburg|DE|53.14|8.21
Paris 17 Batignolles-Monceau|FR|48.88|2.32
Matsusaka|JP|34.58|136.54
Catamarca|AR|-28.47|-65.79
Tochigi|JP|36.38|139.73
Khoroshëvo-Mnevniki|RU|55.78|37.47
Bibirevo|RU|55.88|37.6
Bordj Bou Arreridj|DZ|36.07|4.76
Dīla|ET|6.42|38.32
Jaigaon|IN|26.85|89.38
Atibaia|BR|-23.12|-46.55
Batāla|IN|31.81|75.2
Grenoble|FR|45.18|5.71
Sāmarrā’|IQ|34.2|43.89
Tempe Junction|US|33.41|-111.94
Palmdale|US|34.58|-118.12
George Town|MY|5.41|100.34
El Achir|DZ|36.06|4.63
Hayward|US|37.67|-122.08
Orai|IN|25.99|79.45
Thốt Nốt|VN|10.27|105.53
Gweru|ZW|-19.45|29.82
Abaetetuba|BR|-1.72|-48.88
Centro Habana|CU|23.13|-82.37
Panguíla|AO|-8.69|13.45
Bukit Batok New Town|SG|1.36|103.76
Chom Thong|TH|13.68|100.48
Gol’yanovo|RU|55.82|37.81
Sunggal|ID|3.58|98.62
Industrialnyi|UA|49.95|36.37
Admiralteisky|RU|59.92|30.3
Diourbel|SN|14.65|-16.24
Ueda|JP|36.4|138.28
Aberdeen|HK|22.25|114.15
Avtozavodskyi|UA|49.1|33.43
Salinas|US|36.68|-121.66
San Blas-Canillejas|ES|40.44|-3.62
Cuautla|MX|18.81|-98.96
Salzburg|AT|47.8|13.04
Perbaungan|ID|3.57|98.96
Nong Chok|TH|13.86|100.86
Ussuriysk|RU|43.8|131.96
Arif Wala|PK|26.32|66.3
Nanpiao|CN|41.1|120.75
Livorno|IT|43.54|10.33
Río Cuarto|AR|-33.13|-64.35
Harar|ET|9.31|42.12
Tiraspol|MD|46.84|29.63
Enfield Town|GB|51.65|-0.08
Westonaria|ZA|-26.32|27.65
Lizhi|CN|29.7|107.4
Hitachi-Naka|JP|36.4|140.53
Saharsa|IN|25.87|86.6
Qalyub|EG|30.18|31.21
Escuintla|GT|14.3|-90.79
Marbella|ES|36.52|-4.89
Ereğli|TR|37.51|34.05
Batu Pahat|MY|1.85|102.93
Sitiawan|MY|4.22|100.7
Mariveles|PH|14.43|120.49
San Pablo de las Salinas|MX|19.67|-99.09
Lampang|TH|18.29|99.49
York|GB|53.96|-1.08
Bạc Liêu|VN|9.29|105.73
Juja|KE|-1.1|37.01
Nek’emtē|ET|9.08|36.55
Fès al Bali|MA|34.07|-4.95
Örebro|SE|59.27|15.21
Al Miqdādīyah|IQ|33.98|44.94
Katsuta|JP|36.38|140.53
Malabo|GQ|3.76|8.78
Vidisha|IN|23.53|77.81
Tuy Hòa|VN|13.1|109.32
Yizhou|CN|24.5|108.67
Xinqiao|CN|31.07|121.31
Sunnyvale|US|37.37|-122.04
Tema|GH|5.67|-0.02
Yichun|CN|47.72|128.88
Đức Phổ|VN|14.81|108.96
San Martin Texmelucan de Labastida|MX|19.28|-98.44
Ar Ramthā|JO|32.56|36.01
Hanumāngarh|IN|29.58|74.33
São Mateus|BR|-23.61|-46.48
Zemun|RS|44.85|20.4
Telford|GB|52.68|-2.45
Kisi|NG|9.08|3.85
Nilópolis|BR|-22.81|-43.41
Villa Canales|GT|14.48|-90.53
Guyong|PH|14.84|120.98
Settat|MA|33|-7.62
Brusque|BR|-27.1|-48.91
Paço do Lumiar|BR|-2.53|-44.11
Jampur|PK|29.64|70.6
Port Louis|MU|-20.16|57.5
Kawanishi|JP|34.82|135.42
Thānesar|IN|29.97|76.83
Al Ḩawāmidīyah|EG|29.9|31.25
Hassan|IN|13.01|76.1
Lianghu|CN|29.99|120.9
Tetuán de las Victorias|ES|40.46|-3.7
Kishangarh|IN|26.59|74.85
Birendranagar|NP|28.6|81.62
Dalūpura|IN|28.61|77.32
Guangshui|CN|31.62|114
Saint-Denis|RE|-20.88|55.45
Brăila|RO|45.27|27.97
Lyubertsy|RU|55.68|37.89
Bumba|CD|2.19|22.47
Rudrapur|IN|28.98|79.4
La Serena|CL|-29.91|-71.25
Miskolc|HU|48.1|20.78
Abū Kabīr|EG|30.73|31.67
Fu’an|CN|27.09|119.64
Kitengela|KE|-1.48|36.96
Frisco|US|33.15|-96.82
Zhaodong|CN|46.05|125.96
Wujiaqu|CN|44.16|87.52
Shomolu|NG|6.54|3.37
Janzūr|LY|32.82|13.02
Xai-Xai|MZ|-25.05|33.64
Springfield|US|42.1|-72.59
Nalgonda|IN|17.05|79.27
Katabi|UG|0.08|32.47
Gwangyang|KR|34.94|127.7
Kovrov|RU|56.36|41.32
Viranşehir|TR|37.22|39.76
Noda|JP|35.95|139.87
San Cristóbal|DO|18.42|-70.11
East Chattanooga|US|35.07|-85.25
Limassol|CY|34.68|33.04
Kariya|JP|34.98|136.98
Pasadena|US|29.69|-95.21
Mīt Ghamr|EG|30.72|31.26
Sanshui|CN|23.15|112.89
Jackson|US|32.3|-90.18
Parelheiros|BR|-23.83|-46.73
Enschede|NL|52.22|6.9
Boshan|CN|36.48|117.83
Hazāribāgh|IN|23.99|85.36
Yangchun|CN|22.17|111.78
Souk Ahras|DZ|36.29|7.95
Musanze|RW|-1.5|29.63
Medinīpur|IN|22.42|87.32
Andong|KR|36.57|128.72
Bālurghāt|IN|25.22|88.78
Pomona|US|34.06|-117.75
Valle de La Pascua|VE|9.22|-66.01
Kreuzberg|DE|52.5|13.4
Chincha Alta|PE|-13.41|-76.13
Cairns|AU|-16.92|145.77
Fyzābād|IN|26.78|82.15
Thị Trấn Thuận Châu|VN|21.44|103.69
Dinapore|IN|25.64|85.05
Dingzhou|CN|38.51|114.99
Kansas City|US|39.11|-94.63
As Samawah|IQ|31.33|45.29
Porbandar|IN|21.64|69.61
Sinp’o|KP|40.04|128.19
Pengpu|CN|31.29|121.44
Wazirabad|PK|32.44|74.12
Washington Heights|US|40.85|-73.94
Lakewood|US|39.7|-105.08
Baqubah|IQ|33.75|44.61
Sumayl|IQ|36.86|42.85
Simele|IQ|36.86|42.85
Neuss|DE|51.2|6.69
Chenghua|CN|23.46|116.77
Songnim-ni|KP|38.76|125.64
Bānda|IN|25.48|80.33
Cần Giuộc|VN|10.61|106.67
Balvanera|AR|-34.61|-58.4
Longfeng|CN|46.53|125.1
Beining|CN|41.6|121.79
Strogino|RU|55.82|37.41
Gonbad-e Kāvūs|IR|37.25|55.17
Etwatwa|ZA|-26.13|28.45
Higashimurayama|JP|35.75|139.47
Garanhuns|BR|-8.88|-36.5
Hindupur|IN|13.83|77.49
Amsterdam Nieuw-West|NL|52.36|4.81
Stavanger|NO|58.97|5.73
Bintulu|MY|3.17|113.03
Poole|GB|50.71|-1.98
Akhmīm|EG|26.56|31.75
Kohat|PK|33.58|71.45
Regensburg|DE|49.02|12.1
Layyah|PK|30.96|70.94
Girga|EG|26.34|31.89
Koforidua|GH|6.09|-0.26
Bukit Merah Estate|SG|1.28|103.82
Logroño|ES|42.47|-2.45
Beāwar|IN|26.1|74.32
Sykhiv|UA|49.79|24.06
Shujaabad|PK|29.88|71.29
Escondido|US|33.12|-117.09
Ṣuwayliḥ|JO|32.02|35.84
Erzincan|TR|39.74|39.49
Kırşehir|TR|39.15|34.16
Zarichnyi|UA|50.9|34.81
La Laguna|ES|28.49|-16.32
Kokshetau|KZ|53.28|69.39
Eminabad|PK|32.04|74.26
Anantnag|IN|33.73|75.15
Kukichūō|JP|36.07|139.67
Badajoz|ES|38.88|-6.97
Serilingampalle|IN|17.49|78.3
Malatia-Sebastia|AM|40.17|44.45
Talcahuano|CL|-36.72|-73.12
Chillán|CL|-36.61|-72.1
Jaranwala|PK|31.33|73.42
Kỳ Anh|VN|18.06|106.3
Nong Khaem|TH|13.71|100.35
Piedras Negras|MX|28.7|-100.52
Kızıltepe|TR|37.19|40.58
Astoria|US|40.77|-73.93
Musashino|JP|35.71|139.56
Paranaguá|BR|-25.52|-48.53
Balashikha|RU|55.79|37.95
Raigarh|IN|21.9|83.4
Gloucester|CA|45.35|-75.63
Vryheid|ZA|-27.77|30.79
Malkajgiri|IN|17.45|78.53
Gimcheon|KR|36.12|128.12
Bercham|MY|4.64|101.14
Setia Alam|MY|3.1|101.46
Bandar Tasik Puteri|MY|3.29|101.47
Tordher|PK|33.99|72.29
Zhulebino|RU|55.7|37.85
Dili|TL|-8.56|125.57
Shāntipur|IN|23.25|88.43
Chishtian|PK|29.8|72.86
Playa del Carmen|MX|20.63|-87.08
Santa Rita|BR|-7.11|-34.98
Split|HR|43.51|16.44
Ursynów|PL|52.15|21.05
Hollywood|US|26.01|-80.15
Madrid Centro|ES|40.42|-3.7
Iguatemi|BR|-23.61|-46.43
Harunabad|PK|29.61|73.14
Shūnan|JP|34.08|131.83
Agadez|NE|16.97|7.99
Burnley|GB|53.8|-2.23
Reẖovot|IL|31.89|34.81
Watampone|ID|-4.54|120.33
Sabha|LY|27.04|14.43
Disūq|EG|31.13|30.65
Cagliari|IT|39.23|9.12
Borough Park|US|40.63|-74
Harrow|GB|51.58|-0.33
Berrechid|MA|33.27|-7.59
Queimados|BR|-22.72|-43.56
Tambacounda|SN|13.77|-13.67
Huddersfield|GB|53.65|-1.78
Ārabī|ET|9.96|42.49
Kerch|UA|45.36|36.48
Saguenay|CA|48.42|-71.07
Prenzlauer Berg|DE|52.54|13.42
Fazenda Rio Grande|BR|-25.66|-49.31
Komaki|JP|35.28|136.92
Marvdasht|IR|29.87|52.8
Melitopol|UA|46.85|35.38
Dunhua|CN|43.37|128.23
Bhuj|IN|23.25|69.67
Arganzuela|ES|40.4|-3.7
Jyväskylä|FI|62.24|25.72
Yonago|JP|35.43|133.33
Ruqi|SO|9.97|43.43
Rimini|IT|44.06|12.57
Coquitlam|CA|49.28|-122.78
Aḍ-Ḍawāḥy|EG|31.24|32.28
Arar|SA|30.98|41.04
Valencia|US|34.44|-118.61
Moreno|AR|-34.63|-58.79
Tama|JP|35.64|139.47
Rockford|US|42.27|-89.09
Kalaban Koro|ML|12.57|-8.03
El Limón|VE|10.31|-67.63
Nîmes|FR|43.84|4.36
Dundee|GB|56.47|-2.97
Bārākpur|IN|22.77|88.36
Sao Rafael|BR|-23.63|-46.45
Sujiatun|CN|41.66|123.34
Astanajapura|ID|-6.8|108.63
Xebat|IQ|36.28|43.67
Ciudad Delicias|MX|28.19|-105.47
Siguiri|GN|11.42|-9.17
Mbanza Kongo|AO|-6.27|14.24
Kamsar|GN|10.65|-14.62
East Hampton|US|37.04|-76.33
Honggang|CN|46.4|124.88
Sarrià-Sant Gervasi|ES|41.4|2.14
Kiambu|KE|-1.17|36.84
Clermont-Ferrand|FR|45.78|3.09
Joliet|US|41.53|-88.08
Barrie|CA|44.4|-79.67
Yima|CN|34.74|111.88
Bang Kapi|TH|13.77|100.65
Savannah|US|32.08|-81.1
Paterson|US|40.92|-74.17
Salamanca|ES|40.43|-3.68
Kolomna|RU|55.07|38.78
Hājīpur|IN|25.69|85.21
Rafsanjān|IR|30.41|55.99
Hòa Thành|VN|11.29|106.13
Mestre|IT|45.49|12.25
As Sālimīyah|KW|29.33|48.08
Bridgeport|US|41.18|-73.19
Shevchenko|UA|49.56|34.54
Kuntsevo|RU|55.74|37.4
Kragujevac|RS|44.02|20.92
Aktau|KZ|43.66|51.17
Nusantara|ID|-0.97|116.71
Balcón de la Lisa|CU|23.05|-82.45
Sasarām|IN|24.95|84.02
Bohuniya|UA|50.28|28.61
Iruma|JP|35.82|139.37
Renca|CL|-33.4|-70.71
Kramatorsk|UA|48.73|37.57
Naperville|US|41.79|-88.15
Manama|BH|26.23|50.59
Colima|MX|19.24|-103.71
Bhimavaram|IN|16.54|81.52
Lárisa|GR|39.63|22.42
Nakhodka|RU|42.84|132.92
Debre Birhan|ET|9.68|39.53
Cacuaco|AO|-8.78|13.37
Slobidskyi|UA|49.94|36.28
Aix-en-Provence|FR|43.53|5.45
Cam Ranh|VN|11.92|109.16
Jalalpur Jattan|PK|32.64|74.21
Matanzas|CU|23.04|-81.58
Beed|IN|18.99|75.76
Khasnahzān|IQ|36.2|44.14
Taozhou|CN|30.91|119.41
Saint-Quentin-en-Yvelines|FR|48.77|2.02
Bandar Bukit Raja|MY|3.09|101.43
Blackburn|GB|53.75|-2.48
Rosemont–La Petite-Patrie|CA|45.54|-73.61
Colina|CL|-33.2|-70.67
Burāri|IN|28.76|77.2
Ruda Śląska|PL|50.26|18.86
Nouadhibou|MR|20.94|-17.04
Puerto Plata|DO|19.79|-70.69
Urdaneta|PH|15.98|120.57
Chamberí|ES|40.43|-3.7
Krishnanagar|IN|23.41|88.49
Xinji|CN|37.93|115.22
Jutiapa|GT|14.28|-89.89
Chitradurga|IN|14.22|76.4
Bueng Kum|TH|13.79|100.67
Cambridge|GB|52.2|0.12
Kampung Pasir Gudang Baru|MY|1.47|103.88
Kampung Sungai Glugur|MY|5.37|100.31
Dibrugarh|IN|27.48|94.91
Médéa|DZ|36.26|2.75
Taishan|CN|22.25|112.78
El Eulma|DZ|36.15|5.69
Pécs|HU|46.08|18.23
Giá Rai|VN|9.23|105.46
Abohar|IN|30.14|74.2
Tiruvannamalai|IN|12.23|79.07
Teixeira de Freitas|BR|-17.53|-39.74
Gainesville|US|29.65|-82.32
Concordia|AR|-31.39|-58.02
Botucatu|BR|-22.89|-48.44
Fujieda|JP|34.87|138.27
Spanish Town|JM|17.99|-76.96
Blackpool|GB|53.82|-3.05
Urganch|UZ|41.55|60.63
Bukoba|TZ|-1.33|31.81
Kaithal|IN|29.8|76.4
Ingombota|AO|-8.82|13.23
Brest|FR|48.39|-4.49
Basildon|GB|51.57|0.46
Franco da Rocha|BR|-23.32|-46.73
Salamanca|ES|40.97|-5.66
Villeray–Saint-Michel–Parc-Extension|CA|45.56|-73.61
Mesquite|US|32.77|-96.6
Ashikaga|JP|36.33|139.45
Huyện Lâm Hà|VN|11.82|108.21
Acheng|CN|45.55|126.95
Kelowna|CA|49.88|-119.49
Umarkot|PK|25.36|69.74
León|NI|12.44|-86.88
Kakamigahara|JP|35.42|136.87
Le Mans|FR|48|0.2
Lodhran|PK|29.53|71.63
Campo Largo|BR|-25.46|-49.53
Trois-Rivières|CA|46.35|-72.55
Hailin|CN|44.57|129.39
Amsterdam-Zuid|NL|52.35|4.88
Tsuchiura|JP|36.09|140.21
Elektrostal’|RU|55.79|38.46
Balasore|IN|21.49|86.93
Yong’an|CN|31.02|109.46
Paris 11e Arrondissement|FR|48.86|2.38
Kampong Pasir Ris|SG|1.38|103.93
Huelva|ES|37.27|-6.94
Nemyshlyanskyi|UA|49.96|36.33
Navoiy|UZ|40.08|65.38
Syracuse|US|43.05|-76.15
Ashkelon|IL|31.67|34.57
Pinetown|ZA|-29.82|30.89
Teshi Old Town|GH|5.58|-0.11
Biryulëvo|RU|55.59|37.68
Orekhovo-Borisovo|RU|55.61|37.73
Kusatsu|JP|35.02|135.97
Amsterdam-West|NL|52.38|4.87
Nanjin|CN|29.98|106.27
Guelph|CA|43.55|-80.26
Qianjiang|CN|29.53|108.77
Ramna Maidan|BD|23.73|90.4
Godhra|IN|22.78|73.61
Khemisset|MA|33.82|-6.07
Çanakkale|TR|40.16|26.41
Torrance|US|33.84|-118.34
Três Lagoas|BR|-20.79|-51.7
San Jose|PH|12.35|121.07
Ladysmith|ZA|-28.56|29.78
Lévis|CA|46.8|-71.18
Cachoeirinha|BR|-23.45|-46.66
Heidelberg|DE|49.41|8.69
Fresnillo|MX|23.17|-102.87
Touggourt|DZ|33.11|6.07
Shillong|IN|25.57|91.88
Surprise|US|33.63|-112.33
Norwich|GB|52.63|1.3
Tịnh Biên|VN|10.6|104.94
Moriguchi|JP|34.73|135.57
Amiens|FR|49.9|2.3
Cai Lậy|VN|10.4|106.12
Rewāri|IN|28.2|76.62
Basirhat City|IN|22.66|88.85
Novyye Kuz’minki|RU|55.7|37.75
Kuz’minki|RU|55.7|37.8
Aalborg|DK|57.05|9.92
La Trinidad|PH|16.45|120.59
Ghardaïa|DZ|32.49|3.67
Timika|ID|-4.61|136.68
Pyatigorsk|RU|44.05|43.05
Teófilo Otoni|BR|-17.86|-41.51
Mbanza-Ngungu|CD|-5.26|14.86
Mercier–Hochelaga-Maisonneuve|CA|45.57|-73.55
Okinawa|JP|26.34|127.8
Middlesbrough|GB|54.58|-1.23
Shahrisabz|UZ|39.06|66.83
Moro|PK|26.66|68
Ch’ŏngdan-ŭp|KP|37.97|125.94
Sant Andreu|ES|41.44|2.19
Rybnik|PL|50.1|18.54
Saïda|DZ|34.83|0.15
Metairie Terrace|US|29.98|-90.16
Tuzla|BA|44.54|18.67
Kovpakivskyi|UA|50.93|34.79
eMbalenhle|ZA|-26.53|29.07
Trindade|BR|-16.65|-49.49
Khanpur|PK|28.65|70.66
Columbia|US|34|-81.03
Nawābganj|BD|24.59|88.27
Inezgane|MA|30.36|-9.54
Puerto Cortez|HN|15.83|-87.93
Pasadena|US|34.15|-118.14
Toowoomba|AU|-27.56|151.95
Paderborn|DE|51.72|8.75
Misato, Saitama|JP|35.84|139.88
Chhatarpur|IN|24.92|79.59
Kimberley|ZA|-28.73|24.76
Alto Hospicio|CL|-20.27|-70.1
Ciego de Ávila|CU|21.84|-78.76
Samālūţ|EG|28.31|30.71
Chertanovo Yuzhnoye|RU|55.59|37.6
Jieshou|CN|33.26|115.36
Maykop|RU|44.61|40.1
Attock City|PK|33.77|72.36
Kisaran|ID|2.98|99.62
Mojokerto|ID|-7.47|112.43
Facatativá|CO|4.81|-74.35
Masai|MY|1.49|103.88
Punto Fijo|VE|11.69|-70.2
Myingyan|MM|21.46|95.39
Kamālshahr|IR|35.86|50.87
Mandsaur|IN|24.07|75.07
Zheleznodorozhnyy|RU|55.74|38.02
Chas|IN|23.64|86.17
Jahrom|IR|28.5|53.56
Tours|FR|47.39|0.7
Pālanpur|IN|24.17|72.44
Bondoukou|CI|8.04|-2.8
Chichicastenango|GT|14.94|-91.11
Tarragona|ES|41.12|1.25
Cachoeirinha|BR|-29.95|-51.09
Tobruk|LY|32.09|23.95
Sinch’ŏn-ŭp|KP|38.35|125.48
Abbotsford|CA|49.06|-122.25
Circoiscrizione II|IT|45.05|7.64
Bolton|GB|53.58|-2.43
Yushu|CN|33|97.01
Piteşti|RO|44.85|24.87
Fukayachō|JP|36.2|139.28
Potosí|BO|-19.58|-65.75
Usera|ES|40.39|-3.7
Limoges|FR|45.83|1.25
Cangaiba|BR|-23.5|-46.52
Salto|BR|-23.2|-47.29
Asaka|JP|35.8|139.6
Ghazni|AF|33.55|68.42
Orange|US|33.79|-117.85
Wola|PL|52.23|20.96
Sanhe|CN|29.87|107.73
Īlām|IR|33.64|46.42
Shimotoda|JP|35.82|139.69
Comodoro Rivadavia|AR|-45.86|-67.49
Kampung Sungai Ara|MY|5.33|100.27
Fullerton|US|33.87|-117.93
Killeen|US|31.12|-97.73
Norilsk|RU|69.35|88.2
Lleida|ES|41.62|0.62
Coimbra|PT|40.21|-8.42
Mtwara|TZ|-10.27|40.18
Manjhand|PK|25.91|68.24
Beni|CD|0.49|29.47
Debre Mark’os|ET|10.35|37.73
Norzagaray|PH|14.91|121.05
Qeładizê|IQ|36.18|45.13
Vila Curuca|BR|-23.51|-46.42
Nigel|ZA|-26.43|28.48
Shengavit|AM|40.16|44.48
Catacamas|HN|14.85|-85.89
Buea|CM|4.15|9.24
Shuizhai|CN|23.93|115.76
Al’met’yevsk|RU|54.9|52.32
Paris 12e Arrondissement|FR|48.84|2.44
McAllen|US|26.2|-98.23
Lakhīmpur|IN|27.95|80.78
Ishinomaki|JP|38.42|141.3
Mpumalanga|ZA|-29.81|30.64
Mian Channun|PK|30.44|72.36
Ji Paraná|BR|-10.89|-61.95
Zaanstad|NL|52.45|4.81
Kabin Buri|TH|13.95|101.72
Kuwana|JP|35.05|136.67
Ayacucho|PE|-13.16|-74.22
Torbat-e Ḩeydarīyeh|IR|35.27|59.22
Shanhaiguan|CN|40|119.75
Chamartín|ES|40.46|-3.68
Şaḩam|OM|24.17|56.89
Abéché|TD|13.83|20.83
Peristéri|GR|38.02|23.69
Amersfoort|NL|52.16|5.39
Darwin|AU|-12.46|130.84
Jeongeup|KR|35.6|126.92
Bellevue|US|47.61|-122.2
Korolev|RU|55.91|37.83
Valsād|IN|20.61|72.93
Shinyanga|TZ|-3.66|33.42
Sollentuna|SE|59.43|17.95
Al Hindīyah|IQ|32.54|44.22
Yaizu|JP|34.87|138.32
Payakumbuh|ID|-0.22|100.63
Damoh|IN|23.83|79.44
Āsela|ET|7.95|39.13
Haldwani|IN|29.22|79.53
Irewe|NG|6.42|3.14
Batang|ID|-6.48|110.71
Gbongan|NG|7.48|4.35
Gama|BR|-16.03|-48.07
Siem Reap|KH|13.36|103.86
Anaco|VE|9.43|-64.46
Purwodadi|ID|-7.09|110.92
Koga|JP|36.18|139.72
Yuepu|CN|31.43|121.42
Hābra|IN|22.84|88.66
Sidoarjo|ID|-7.45|112.72
Kyivskyi|UA|48.05|37.78
Şabāḩ as Sālim|KW|29.26|48.06
Balneário Camboriú|BR|-26.99|-48.63
Plaza de la Revolución|CU|23.12|-82.39
Lausanne|CH|46.52|6.63
Choloma|HN|15.61|-87.95
Barcarena|BR|-1.51|-48.63
Kairouan|TN|35.68|10.1
Stockport|GB|53.41|-2.16
Budapest XI. kerület|HU|47.48|19.04
Huadian|CN|42.97|126.74
Crato|BR|-7.23|-39.41
Kousséri|CM|12.08|15.03
Weru|ID|-6.71|108.5
Al-'Ubūr|EG|30.23|31.48
Kolpino|RU|59.75|30.59
Itapipoca|BR|-3.49|-39.58
Conselheiro Lafaiete|BR|-20.66|-43.79
Belgrano|AR|-34.56|-58.46
Sarh|TD|9.15|18.38
Gingoog|PH|8.83|125.1
San Juan del Río|MX|20.39|-100
Sekondi-Takoradi|GH|4.93|-1.76
Liuzhi|CN|26.23|105.43
Altamira|BR|-3.2|-52.21
Naga|PH|10.21|123.76
Fuyu|CN|45.18|124.82
Wūdān|CN|42.93|119.02
Vespasiano|BR|-19.69|-43.92
Whitby|CA|43.88|-78.93
Metairie|US|29.98|-90.15
Chaohu|CN|31.6|117.87
Kolār|IN|13.14|78.13
Bizerte|TN|37.27|9.87
Táriba|VE|7.82|-72.22
Ejigbo|NG|7.9|4.31
Santa Cruz do Sul|BR|-29.72|-52.43
Ksar El Kebir|MA|35|-5.9
Paris 11 Popincourt|FR|48.86|2.38
Dabou|CI|5.33|-4.38
Bukit Panjang New Town|SG|1.38|103.76
Sao Lucas|BR|-23.59|-46.54
Paris 12 Reuilly|FR|48.84|2.39
Bertoua|CM|4.58|13.68
Jacmel|HT|18.24|-72.54
Srikakulam|IN|18.3|83.9
Candelaria|PH|13.93|121.42
Araruama|BR|-22.87|-42.34
Vĩnh Long|VN|10.25|105.97
Praia|CV|14.93|-23.51
Resende|BR|-22.47|-44.45
Liangping|CN|30.66|107.77
Kirdāsah|EG|30.03|31.11
Ponce|PR|18.01|-66.62
Doilungdêqên|CN|29.66|90.99
Jieshi|CN|22.81|115.83
Hejiang|CN|28.81|105.83
Pasir Puteh|MY|5.83|102.4
Mandya|IN|12.52|76.9
Xiayang|CN|31.15|121.12
Nor Nork|AM|40.2|44.57
Bhisho|ZA|-32.85|27.44
Freguesia do Ó|BR|-23.5|-46.7
Subang|ID|-6.57|107.76
Madhurampur Dehri|IN|24.97|84.2
Negombo|LK|7.21|79.84
Irákleion|GR|35.33|25.14
Hampton|US|37.03|-76.35
Wuyishan|CN|27.76|118.03
Miramar|US|25.99|-80.23
Jiashan|CN|30.85|120.93
Jiagedaqi|CN|50.42|124.12
Bilqās|EG|31.21|31.36
Rangkasbitung|ID|-6.36|106.25
Odintsovo|RU|55.67|37.28
Foggia|IT|41.46|15.55
Antsiranana|MG|-12.32|49.29
Kānchrāpāra|IN|22.96|88.43
San Juan Sacatepéquez|GT|14.72|-90.64
Minoh|JP|34.83|135.47
Funtua|NG|11.52|7.31
St. Catharines|CA|43.17|-79.24
Dawei|MM|14.08|98.19
Igboho|NG|8.84|3.76
Gunungsitoli|ID|1.29|97.61
Apeldoorn|NL|52.21|5.97
Cidade Lider|BR|-23.56|-46.49
Marīvān|IR|35.52|46.18
Phủ Lý|VN|20.55|105.91
Divo|CI|5.84|-5.36
Huinong|CN|39.23|106.77
Ebina|JP|35.38|139.4
Larache|MA|35.19|-6.16
Varginha|BR|-21.55|-45.43
Paris 14 Observatoire|FR|48.83|2.33
Van Nuys|US|34.19|-118.45
Būsh|EG|29.15|31.13
Mlolongo|KE|-1.4|36.94
Guarapari|BR|-20.67|-40.5
Tương Mai|VN|20.99|105.86
San José del Cabo|MX|23.05|-109.7
West Valley City|US|40.69|-112
Kisarazu|JP|35.38|139.93
Gejiu|CN|23.36|103.15
Bacău|RO|46.57|26.91
Saaba|BF|12.37|-1.41
Mingaladon|MM|16.92|96.1
Dimāpur|IN|25.91|93.72
Sasolburg|ZA|-26.81|27.82
Cheras|MY|3.11|101.73
Tasek Glugor|MY|5.48|100.5
Osorno|CL|-40.57|-73.13
Amsterdam-Oost|NL|52.35|4.93
Araras|BR|-22.36|-47.38
Tumxuk|CN|39.87|79.06
Kushtia|BD|23.9|89.12
Pitalito|CO|1.85|-76.05
Baliuag|PH|14.95|120.9
Hoàn Kiếm|VN|21.03|105.85
Kajansi|UG|0.22|32.53
Isahaya|JP|32.84|130.04
Dayton|US|39.76|-84.19
Cẩm Phả Mines|VN|21.02|107.3
Petapa|GT|14.5|-90.56
Māler Kotla|IN|30.53|75.88
Buguma|NG|4.74|6.86
Itaituba|BR|-4.28|-55.98
Ahuntsic-Cartierville|CA|45.57|-73.67
Shiqiao|CN|22.95|113.36
Pyay|MM|18.82|95.22
Rabak|SD|13.18|32.74
Tây Ninh|VN|11.31|106.1
Le Vieux-Longueuil|CA|45.54|-73.51
Tyre|LB|33.27|35.19
Kutaisi|GE|42.27|42.69
Andīmeshk|IR|32.46|48.35
Siwān|IN|26.22|84.36
Madrid|CO|4.73|-74.26
Angono|PH|14.53|121.15
Cartago|CO|4.75|-75.91
Shahreẕā|IR|32.01|51.86
Hinthada|MM|17.65|95.46
Apucarana|BR|-23.55|-51.46
Cap-Haïtien|HT|19.76|-72.2
Baturaja|ID|-4.13|104.17
Inazawa|JP|35.25|136.78
Rodriguez|PH|14.76|121.2
Kalol|IN|23.25|72.5
Mīāndoāb|IR|36.97|46.11
São Mateus|BR|-18.72|-39.86
Laghouat|DZ|33.8|2.87
Nevinnomyssk|RU|44.63|41.94
San Mateo|PH|14.7|121.12
Ţahţā|EG|26.77|31.5
San Juan|PH|14.6|121.03
Sibiu|RO|45.8|24.15
Olathe|US|38.88|-94.82
El Geneina Fort|SD|13.47|22.46
Ikirun|NG|7.91|4.67
Shenglilu|CN|29.35|105.88
San Nicolás de los Arroyos|AR|-33.33|-60.21
Léogâne|HT|18.51|-72.63
Vila Jacui|BR|-23.5|-46.46
Adiwerna|ID|-6.94|109.13
Cametá|BR|-2.24|-49.5
Al Qurnah|IQ|31.02|47.43
Abakaliki|NG|6.32|8.11
Vitória de Santo Antão|BR|-8.12|-35.29
Marianao|CU|23.07|-82.43
Warren|US|42.49|-83.01
Cizre|TR|37.33|42.18
Circoiscrizione VIII|IT|45.04|7.67
Bānkura|IN|23.23|87.07
İnegol|TR|40.08|29.51
Ebetsu|JP|43.11|141.55
Anyama|CI|5.49|-4.05
Jiawang|CN|34.43|117.44
Singaraja|ID|-8.11|115.09
Pātan|IN|23.85|72.13
Würzburg|DE|49.79|9.95
Barysaw|BY|54.23|28.51
Đồng Hới|VN|17.47|106.62
Randfontein|ZA|-26.18|27.7
Pervouralsk|RU|56.91|59.94
Gondā City|IN|27.13|81.95
Madīnat Ḩamad|BH|26.12|50.51
Ōme|JP|35.78|139.24
Sinnūris|EG|29.41|30.87
Votorantim|BR|-23.55|-47.44
Milagro|EC|-2.13|-79.59
Jaú|BR|-22.3|-48.56
Thandwe|MM|18.47|94.37
Thornton|US|39.87|-104.97
Valdivia|CL|-39.81|-73.25
Olmaliq|UZ|40.84|69.6
Okrika|NG|4.74|7.08
High Wycombe|GB|51.63|-0.75
Carrollton|US|32.95|-96.89
Talisay|PH|10.24|123.85
Gao|ML|16.27|-0.04
Dhaulpur|IN|26.69|77.88
Tarime|TZ|-1.35|34.37
Kentron|AM|40.18|44.51
Milton|CA|43.52|-79.88
M'Sila|DZ|35.71|4.54
Narita|JP|35.78|140.32
Franceville|GA|-1.63|13.58
Puqi|CN|29.72|113.88
Tondabayashichō|JP|34.5|135.6
Sandachō|JP|34.88|135.23
Gondiā|IN|21.46|80.19
Dunedin|NZ|-45.87|170.5
Kislovodsk|RU|43.91|42.72
Kyauktan|MM|16.64|96.33
Schaerbeek|BE|50.87|4.38
Hoofddorp|NL|52.3|4.69
Machiques|VE|10.06|-72.55
Palakkad|IN|10.77|76.65
Silifke|TR|36.38|33.93
Charleston|US|32.78|-79.93
Langley|CA|49.1|-122.66
Midland|US|32|-102.08
Fujinomiya|JP|35.22|138.62
Mingala Tangnyunt|MM|16.79|96.17
Innsbruck|AT|47.26|11.39
Bragança|BR|-1.05|-46.77
Kingston|CA|44.23|-76.48
Wugang|CN|26.73|110.63
Gloucester|GB|51.87|-2.24
Waco|US|31.55|-97.15
Cerro|CU|23.11|-82.38
Zama|JP|35.49|139.39
Manokwari|ID|-0.86|134.06
Valinhos|BR|-22.97|-47
Dimitrovgrad|RU|54.21|49.62
Zhalantun|CN|48.01|122.74
Bettiah|IN|26.8|84.5
Maijdi|BD|22.87|91.1
São Félix do Xingu|BR|-6.64|-51.99
San Pedro Garza García|MX|25.66|-100.4
Sapucaia do Sul|BR|-29.82|-51.15
Kombolcha|ET|11.08|39.74
Muricay|PH|7.83|123.48
Sterling Heights|US|42.58|-83.03
Surat Thani|TH|9.14|99.33
Fürth|DE|49.48|10.99
Ferrara|IT|44.84|11.62
Quận Đức Thịnh|VN|10.31|105.74
Isidro Casanova|AR|-34.7|-58.59
Ōmuta|JP|33.03|130.45
Villa Mercedes|CL|-37.4|-71.98
Fuji|CN|29.15|105.37
Palwal|IN|28.14|77.33
Bielany|PL|52.29|20.94
Dawukou|CN|39.04|106.4
Bulaon|PH|15.08|120.66
Garut|ID|-7.24|107.92
Ajdabiya|LY|30.76|20.23
Abiko|JP|35.87|140.02
Kadoma|JP|34.74|135.57
Majie|CN|25.03|102.64
Bhakkar|PK|31.63|71.06
Rio Pequeno|BR|-23.57|-46.76
Kāshmar|IR|35.24|58.47
Jijel|DZ|36.82|5.76
Martapura|ID|-3.41|114.86
Villeurbanne|FR|45.77|4.88
Hải Châu|VN|15.92|108.13
Limbe|CM|4.02|9.21
Rānīganj|IN|23.62|87.13
Hepo|CN|23.43|115.83
Iranshahr|IR|27.2|60.68
Soubré|CI|5.78|-6.59
Onomichi|JP|34.42|133.2
Denton|US|33.21|-97.13
Etah|IN|27.56|78.66
Pīlibhīt|IN|28.63|79.8
Shangzhi|CN|45.21|128
Lashio|MM|22.94|97.75
Rayon KhTZ|UA|49.94|36.37
Novomoskovsk|RU|54.01|38.29
Matsubara|JP|34.57|135.55
Abengourou|CI|6.73|-3.5
Al Bāb|SY|36.37|37.52
Shuangcheng|CN|45.38|126.31
Exeter|GB|50.72|-3.53
Circoiscrizione III|IT|45.06|7.63
Ho|GH|6.6|0.47
Narowal|PK|32.1|74.87
Lào Cai|VN|22.49|103.97
Al Ajaylat|LY|32.76|12.38
Udon Thani|TH|17.42|102.79
Baḥarkah|IQ|36.32|44.04
Bayan Lepas|MY|5.3|100.26
Petrogradka|RU|59.97|30.31
Rajapalayam|IN|9.45|77.55
Zipaquirá|CO|5.02|-74
Jīroft|IR|28.68|57.74
Cedar Rapids|US|42.01|-91.64
Dongyang|CN|29.27|120.23
Nantou|CN|22.72|113.29
Botad|IN|22.17|71.67
Nablus|PS|32.22|35.25
New Haven|US|41.31|-72.93
Arcahaie|HT|18.77|-72.51
Jiazi|CN|22.88|116.07
Foumban|CM|5.73|10.9
Roseville|US|38.75|-121.29
Quilpué|CL|-33.05|-71.44
Rawson|AR|-31.58|-68.54
Sīdī Ḥusayn|TN|36.76|10.12
Kati|ML|12.74|-8.07
Seri Kembangan|MY|3.03|101.72
Kembangan|SG|1.32|103.91
Colchester|GB|51.89|0.9
Umeå|SE|63.83|20.26
Din Daeng|TH|13.79|100.57
Chaman|PK|30.92|66.45
Sennar|SD|13.57|33.57
Masaya|NI|11.97|-86.1
Visalia|US|36.33|-119.29
Nankana Sahib|PK|31.45|73.71
Caála|AO|-12.85|15.56
Sonārgaon|BD|23.65|90.62
Dongxing|CN|21.55|107.97
Tottenham|GB|51.6|-0.07
Zugló|HU|47.52|19.11
Aley|LB|33.81|35.6
San Martin|PE|-5.19|-80.67
Tychy|PL|50.14|18.97
Ramenki|RU|55.7|37.5
Cambridge|CA|43.36|-80.31
Mardin|TR|37.31|40.74
Pingxiang|CN|22.1|106.76
Zwolle|NL|52.51|6.09
Baidoa|SO|3.11|43.65
Sầm Sơn|VN|19.73|105.9
Santo António|CN|22.2|113.54
Salford|GB|53.49|-2.29
Mandi Bahauddin|PK|32.59|73.49
Tokat|TR|40.31|36.55
Erebuni|AM|40.13|44.53
Ô Môn|VN|10.11|105.62
Gapan|PH|15.31|120.95
Deoria|IN|26.5|83.78
Bayambang|PH|15.81|120.46
Mianwali|PK|32.58|71.53
Coral Springs|US|26.27|-80.27
Sherbrooke|CA|45.4|-71.9
Al Bayḑā’|LY|32.76|21.76
Jardim Helena|BR|-23.48|-46.41
Sabará|BR|-19.89|-43.81
Acilia-Castel Fusano-Ostia Antica|IT|41.76|12.33
Charlottenburg|DE|52.52|13.28
Thousand Oaks|US|34.17|-118.84
Columbia|US|38.95|-92.33
Colatina|BR|-19.54|-40.63
Győr|HU|47.68|17.64
Copiapó|CL|-27.37|-70.33
Kokubunji|JP|35.7|139.48
Quibdó|CO|5.69|-76.66
Guelmim|MA|28.99|-10.06
Charallave|VE|10.24|-66.86
Shahr-e Kord|IR|32.33|50.86
Malambo|CO|10.86|-74.77
Tatuí|BR|-23.36|-47.86
Iwakuni|JP|34.16|132.22
Leiyang|CN|26.4|112.86
Białołeka|PL|52.32|20.97
Cadiz|PH|10.95|123.29
Carnot|CF|4.94|15.88
Bat Yam|IL|32.02|34.75
Zacatecas|MX|22.77|-102.58
Elizabeth|US|40.66|-74.21
Zyablikovo|RU|55.62|37.77
Daur|PK|26.46|68.32
Bingöl|TR|38.88|40.49
Copacabana|BR|-22.97|-43.19
Sātkhira|BD|22.71|89.07
Parung|ID|-6.42|106.73
Palo Negro|VE|10.17|-67.54
Stamford|US|41.05|-73.54
Idlib|SY|35.93|36.63
Moanda|CD|-5.93|12.37
Sīnah|IQ|36.81|43.04
Ōsaki|JP|38.59|140.97
Magelang|ID|-7.47|110.22
Concord|US|37.98|-122.03
Leiria|PT|39.74|-8.81
Puno|PE|-15.84|-70.02
Kamyshin|RU|50.09|45.41
Shuanglonghu|CN|29.72|106.61
Nimach|IN|24.46|74.87
Kafr ad Dawwār|EG|31.13|30.13
Águas Claras|BR|-15.84|-48.03
Bosque Saúde|BR|-23.61|-46.62
Novocheboksarsk|RU|56.11|47.48
Besançon|FR|47.25|6.02
Lugazi|UG|0.37|32.94
Thành phố Sông Công|VN|21.48|105.84
Rosario|PH|13.63|121.22
Khardah|IN|22.72|88.38
Sakakah|SA|29.97|40.21
Khenifra|MA|32.93|-5.66
Al Manāqil|SD|14.25|32.99
Rustavi|GE|41.56|44.98
Jose Bonifacio|BR|-23.57|-46.43
Manzanillo|CU|20.34|-77.12
Yavatmāl|IN|20.39|78.13
Hālīsahar|IN|22.93|88.42
Serpukhov|RU|54.92|37.42
Rionegro|CO|6.16|-75.37
Shache|CN|38.42|77.24
Siheungdong|KR|37.45|126.91
Khanna|IN|30.71|76.22
Koidu|SL|8.64|-10.97
Norman|US|35.22|-97.44
Mosquera|CO|4.71|-74.23
Orekhovo-Borisovo Severnoye|RU|55.62|37.68
Ivanovskoye|RU|55.77|37.83
Bento Gonçalves|BR|-29.17|-51.52
Buôn Hồ|VN|12.95|108.3
Chũ|VN|21.37|106.57
Västerås|SE|59.62|16.55
Seto|JP|35.23|137.1
Alhambra|US|33.5|-112.13
Titāgarh|IN|22.74|88.37
Newcastle under Lyme|GB|53|-2.23
Opole|PL|50.67|17.93
Worcester|ZA|-33.65|19.45
Elbląg|PL|54.15|19.41
Gaojing|CN|31.32|121.48
Sirajganj|BD|24.46|89.71
Jequié|BR|-13.86|-40.09
Płock|PL|52.55|19.71
Siguatepeque|HN|14.6|-87.83
Wałbrzych|PL|50.77|16.28
Yevlakh|AZ|40.62|47.15
Mykilska Borshchahivka|UA|50.43|30.37
Al Manzalah|EG|31.16|31.94
Wau|SS|7.7|27.99
Songnan|CN|31.35|121.48
Södermalm|SE|59.31|18.08
Athens|US|33.96|-83.38
Amaigbo|NG|5.79|7.84
Vila Mariana|BR|-23.59|-46.63
Chiang Mai|TH|18.79|98.98
Lafia|NG|8.49|8.52
Jiangyou|CN|31.77|104.72
Cikampek|ID|-6.42|107.46
Mustafābād|IN|28.72|77.27
Tengyue|CN|24.99|98.51
Shajing|CN|22.75|113.82
Jinfeng|CN|28.24|116.6
Sancti Spíritus|CU|21.93|-79.44
Mataró|ES|41.54|2.44
Barretos|BR|-20.56|-48.57
Kent|US|47.38|-122.23
Pakokku|MM|21.33|95.08
Murom|RU|55.57|42.02
Daska Kalan|PK|32.32|74.35
Sertãozinho|BR|-21.14|-47.99
Hāthras|IN|27.6|78.05
Pulong Santa Cruz|PH|14.27|121.08
Klaten|ID|-7.71|110.61
Khasavyurt|RU|43.25|46.59
Neftekamsk|RU|56.09|54.26
Villaverde|ES|40.35|-3.7
Simi Valley|US|34.27|-118.78
Bayawan|PH|9.36|122.8
Shakargarh|PK|32.26|75.16
Jorhat|IN|26.76|94.2
Santa Cruz|PH|14.6|120.98
La Victoria|VE|10.23|-67.33
Pakpattan|PK|30.34|73.39
Jingzhi|CN|36.31|119.39
Danshui|CN|22.8|114.47
Circoiscrizione V|IT|45.1|7.66
Solihull|GB|52.41|-1.78
East Los Angeles|US|34.02|-118.17
Lalitpur|IN|24.69|78.42
Jombang|ID|-7.55|112.23
Maxixe|MZ|-23.86|35.35
Nakhon Ratchasima|TH|14.97|102.1
Chinandega|NI|12.63|-87.13
Al Jadīd|LY|27.05|14.4
Lambaré|PY|-25.35|-57.61
Iizuka|JP|33.64|130.69
Hua Hin|TH|12.57|99.96
San Carlos del Zulia|VE|9|-71.93
Vilkhivskyi|UA|48.54|39.28
Rafaḩ|PS|31.3|34.24
Ampang|MY|3.15|101.77
Guntakal|IN|15.17|77.36
Ālā'ĕr|CN|40.54|81.27
Santa Clara|US|37.35|-121.96
Pithampur|IN|22.6|75.7
Paseh|ID|-7.07|107.79
Mothīhāri|IN|26.65|84.92
Koganei|JP|35.7|139.51
Retiro|ES|40.41|-3.68
Nossa Senhora de Fátima|CN|22.21|113.55
Sunset Park|US|40.65|-74.01
Topeka|US|39.05|-95.68
Orléans|CA|45.46|-75.5
Paek'ak|KP|39.46|125.61
Huicheng|CN|23.04|116.29
Puerto Ayacucho|VE|5.66|-67.58
Gashua|NG|12.87|11.04
Les Cayes|HT|18.19|-73.75
Salerno|IT|40.68|14.79
Savannakhet|LA|16.57|104.76
Munūf|EG|30.47|30.93
Watford|GB|51.66|-0.4
Guará|BR|-15.81|-47.97
Giresun|TR|40.92|38.39
Xiazhen|CN|34.8|117.11
Chaeryŏng-ni|KP|38.74|125.23
Kastamonu|TR|41.38|33.78
Kanhangad|IN|12.31|75.11
‘Ajlūn|JO|32.33|35.75
Derince|TR|40.76|29.81
Sukawati|ID|-8.49|115.05
Jagdalpur|IN|19.08|82.02
Kuopio|FI|62.89|27.68
Bang Sue|TH|13.81|100.53
Mailsi|PK|29.8|72.17
Los Ángeles|CL|-37.47|-72.35
Haimen|CN|23.19|116.61
Karabük|TR|41.2|32.63
Ntuzuma|ZA|-29.74|30.95
Tsuruoka|JP|38.72|139.82
Saint Peters|GB|51.37|1.42
Barbacena|BR|-21.23|-43.77
Uruma|JP|26.38|127.86
Debre Tabor|ET|11.85|38.02
Sakiet ed Daier|TN|34.79|10.81
Nzega|TZ|-4.22|33.18
Abilene|US|32.45|-99.73
Ban Samae Dam|TH|13.59|100.39
Shahecheng|CN|36.94|114.51
Kumbo|CM|6.2|10.67
Ottawa South|CA|45.39|-75.69
Willemstad|CW|12.12|-68.89
Bălţi|MD|47.76|27.93
Dokri|PK|27.37|68.1
Tyoply Stan|RU|55.62|37.49
Az Zulfī|SA|26.3|44.82
Sultan Kudarat|PH|7.23|124.26
Bet Shemesh|IL|31.73|34.99
Jagādhri|IN|30.17|77.3
Huixquilucan|MX|19.36|-99.35
Arapongas|BR|-23.42|-51.42
Semnan|IR|35.58|53.39
León|ES|42.6|-5.57
San Francisco de Macorís|DO|19.29|-70.25
Yushu|CN|44.83|126.54
Yuanlin|TW|23.96|120.58
Santa Tecla|SV|13.68|-89.28
Sorriso|BR|-12.55|-55.71
Ciudad Valles|MX|22|-99.01
Ouahigouya|BF|13.58|-2.42
Poblacion|PH|14.38|121.03
Kashihara-shi|JP|34.51|135.79
Ashmūn|EG|30.3|30.98
Ağrı|TR|39.71|43.04
Leeuwarden|NL|53.2|5.81
Bến Tre|VN|10.24|106.38
Monza|IT|45.58|9.27
New Mirpur City|PK|33.15|73.75
Chía|CO|4.86|-74.06
Olanchito|HN|15.48|-86.57
Koreatown|US|34.06|-118.3
Targówek|PL|52.29|21.05
Lecheng|CN|25.13|113.35
Nancun|CN|36.53|120.13
Marand|IR|38.43|45.77
As Sinbillāwayn|EG|30.88|31.46
Crawley|GB|51.11|-0.18
Rudnyy|KZ|52.97|63.11
Magangué|CO|9.24|-74.75
Itaguaí|BR|-22.85|-43.78
Bemowo|PL|52.25|20.91
Metz|FR|49.12|6.17
Jiupu|CN|41.07|122.95
Dārjiling|IN|27.03|88.27
Baoshan|CN|46.57|131.39
Salvaleón de Higüey|DO|18.62|-68.71
Butanta|BR|-23.57|-46.73
Thaton|MM|16.92|97.37
Budapest III. kerület|HU|47.54|19.05
Kurichchi|IN|10.96|76.97
Lumajang|ID|-8.13|113.22
Ise|JP|34.48|136.7
Hagonoy|PH|14.83|120.73
Samandağ|TR|36.08|35.98
Caraguatatuba|BR|-23.62|-45.41
Birigui|BR|-21.29|-50.34
Pinsk|BY|52.12|26.07
Telde|ES|27.99|-15.42
Indramayu|ID|-6.33|108.32
Relizane|DZ|35.74|0.56
Bordj el Kiffan|DZ|36.75|3.19
Manas|KG|40.94|72.99
Kirishima|JP|31.74|130.76
Orizaba|MX|18.85|-97.1
Luoyang|CN|23.16|114.27
Toba Tek Singh|PK|30.97|72.48
Honmachi|JP|32.5|130.6
Wolfsburg|DE|52.42|10.78
Umuarama|BR|-23.77|-53.32
Niihama|JP|33.96|133.31
Jiaohe|CN|43.72|127.33
Igarassu|BR|-7.83|-34.91
Tsaritsyno|RU|55.63|37.65
Dos Hermanas|ES|37.28|-5.92
Ajapnyak|AM|40.2|44.47
Tabuk|PH|17.41|121.44
Dam Dam|IN|22.63|88.42
Hoima|UG|1.43|31.35
Wuda|CN|39.5|106.71
Az Zubayr|IQ|30.39|47.7
Schöneberg|DE|52.5|13.34
Beppu|JP|33.28|131.5
Hardoī|IN|27.39|80.13
Behbahān|IR|30.6|50.24
Itatiba|BR|-23.01|-46.84
Huangzhou|CN|30.45|114.8
Sheepshead Bay|US|40.59|-73.94
Puruliya|IN|23.33|86.36
Ubon Ratchathani|TH|15.24|104.85
Virginia|ZA|-28.1|26.87
Brits|ZA|-25.63|27.78
Recklinghausen|DE|51.61|7.2
Zhoucun|CN|36.82|117.82
Cherkessk|RU|44.22|42.05
Haveli Lakha|PK|30.45|73.69
Maastricht|NL|50.85|5.69
Amherst|US|42.98|-78.8
Tekirdağ|TR|40.98|27.51
Shahr-e Ṣadrā|IR|29.8|52.5
Victorville|US|34.54|-117.29
Burton upon Trent|GB|52.81|-1.64
Calumpit|PH|14.92|120.77
Lat Phrao|TH|13.8|100.61
Livoberezhnyi|UA|47.11|37.64
Göttingen|DE|51.53|9.93
Titiwangsa|MY|3.18|101.7
Phasi Charoen|TH|13.71|100.44
Veshnyaki|RU|55.72|37.82
Presnenskiy|RU|55.76|37.56
Zābol|IR|31.03|61.49
Kaya|BF|13.09|-1.08
Xiangcheng|CN|25.47|100.56
Dharmavaram|IN|14.41|77.72
Gokalpur|IN|28.7|77.29
Ādīgrat|ET|14.28|39.46
Kotamobagu|ID|0.74|124.31
Carora|VE|10.17|-70.08
Vallejo|US|38.1|-122.26
Bhadreswar|IN|22.82|88.34
Dorūd|IR|33.49|49.06
Bern|CH|46.95|7.45
San Pedro de la Paz|CL|-36.84|-73.1
Nagaon|IN|26.35|92.67
Lahti|FI|60.98|25.66
Vejalpur|IN|22.69|73.56
Longshui|CN|29.57|105.76
Siracusa|IT|37.08|15.29
Mubende|UG|0.56|31.39
Stara Zagora|BG|42.43|25.64
Ondjiva|AO|-17.07|15.73
Alberton|ZA|-26.27|28.12
Gràcia|ES|41.4|2.16
Chikmagalūr|IN|13.32|75.77
Ekibastuz|KZ|51.72|75.32
Algeciras|ES|36.13|-5.45
Lafayette|US|30.22|-92.02
Lianhe|CN|47.13|129.27
Chico|US|39.73|-121.84
Bhadrak|IN|21.05|86.52
Bagé|BR|-31.33|-54.11
North Stamford|US|41.14|-73.54
Bergamo|IT|45.7|9.67
Ruse|BG|43.85|25.95
Sawai Madhopur|IN|26.02|76.34
Chơn Thành|VN|11.43|106.64
Ambikāpur|IN|23.12|83.2
Eunápolis|BR|-16.38|-39.58
Apalit|PH|14.95|120.77
Hartford|US|41.76|-72.69
Bukittinggi|ID|-0.31|100.37
Dolisie|CG|-4.2|12.67
Zyuzino|RU|55.66|37.57
Ejido|VE|8.55|-71.24
Berkeley|US|37.87|-122.27
Nova Lima|BR|-19.99|-43.85
Plaridel|PH|14.89|120.86
West Palm Beach|US|26.72|-80.05
Kashiwara|JP|34.45|135.77
Uruguaiana|BR|-29.75|-57.09
Ikoma|JP|34.68|135.7
Heilbronn|DE|49.14|9.22
El Mourouj|TN|36.71|10.21
Ţūz Khūrmātū|IQ|34.89|44.63
Trento|IT|46.07|11.12
Shahdad Kot|PK|27.85|67.91
Catchiungo|AO|-12.57|16.23
Ingolstadt|DE|48.77|11.42
Toa Payoh New Town|SG|1.34|103.85
Lichuan|CN|30.3|108.85
Bukit Bintang|MY|3.15|101.71
La Concepción|VE|10.62|-71.84
Ulm|DE|48.4|9.99
Mandoli|IN|28.7|77.31
San Carlos|VE|9.66|-68.59
Włocławek|PL|52.65|19.07
Allentown|US|40.61|-75.49
Satara|IN|17.69|73.99
Bao'an Centre|CN|22.58|113.92
Charsadda|PK|34.15|71.74
Fernando de la Mora|PY|-25.34|-57.52
Chūru|IN|28.3|74.97
Perugia|IT|43.11|12.39
Gangāpur|IN|26.47|76.72
Zhujing|CN|30.9|121.16
Bồ Đề|VN|21.06|105.87
Guelma|DZ|36.46|7.43
International City|AE|25.16|55.41
Dubai Marina|AE|25.09|55.15
Zhaoyuan|CN|37.36|120.41
Nabatîyé et Tahta|LB|33.38|35.48
Rustaq|OM|23.39|57.42
Solntsevo|RU|55.64|37.38
Orekhovo-Zuyevo|RU|55.81|38.99
Gereida|SD|11.28|25.14
Cabudwaaq|SO|6.25|46.22
Cheremushky|UA|46.43|30.71
Madhyapur Thimi|NP|27.68|85.39
Saint-Louis-de-Terrebonne|CA|45.7|-73.79
Evansville|US|37.97|-87.56
Bonon|CI|6.93|-6.05
Bottrop|DE|51.52|6.93
Ghotki|PK|28|69.32
Kwekwe|ZW|-18.93|29.81
Malindi|KE|-3.22|40.12
Ban I Chang|TH|13.71|99.9
Rize|TR|41.02|40.52
Almirante Tamandaré|BR|-25.32|-49.31
Palm Bay|US|28.03|-80.59
Ann|MM|19.8|94.05
Leiden|NL|52.16|4.49
Thon Buri|TH|13.73|100.49
Ajax|CA|43.85|-79.03
Bergedorf|DE|53.48|10.23
Sambrial|PK|32.48|74.35
Pescara|IT|42.46|14.2
Modakeke|NG|7.38|4.26
Nobeoka|JP|32.58|131.67
Silang|PH|14.22|120.97
Amanfrom|GH|5.54|-0.4
Marituba|BR|-1.36|-48.34
Paulo Afonso|BR|-9.41|-38.21
Moḩammad Shahr|IR|35.76|50.92
Īz̄eh|IR|31.83|49.87
Nazilli|TR|37.92|28.32
Daitō|JP|34.71|135.62
Hòa Cường|VN|16.04|108.18
Lira|UG|2.25|32.9
Pforzheim|DE|48.88|8.7
Salihli|TR|38.48|28.15
Arabkir|AM|40.21|44.5
Port Dickson|MY|2.52|101.8
Berkane|MA|34.92|-2.32
Catanduva|BR|-21.14|-48.97
Dordrecht|NL|51.81|4.67
Battambang|KH|13.1|103.2
Offenbach|DE|50.1|8.77
Kitami|JP|43.8|143.89
Vĩnh Yên|VN|21.31|105.6
Madhavaram|IN|13.15|80.23
Cagua|VE|10.19|-67.46
Fujairah|AE|25.12|56.34
Mandimba|MZ|-14.35|35.65
Reykjavík|IS|64.14|-21.9
Dohad|IN|22.83|74.26
Cheltenham|GB|51.9|-2.08
Huaraz|PE|-9.53|-77.53
Santa Coloma de Gramenet|ES|41.45|2.21
Santana|BR|-0.04|-51.17
Araxá|BR|-19.59|-46.94
Piraquara|BR|-25.44|-49.07
Barshi|IN|18.23|75.69
Bắc Quang|VN|22.48|104.87
Xunchang|CN|28.45|104.71
Hưng Yên|VN|20.65|106.05
Miramar|MX|22.36|-97.9
Bremerhaven|DE|53.55|8.58
Queenstown|ZA|-31.9|26.88
Nanbin|CN|30|108.11
Bandar-e Anzalī|IR|37.47|49.46
Khlong Luang|TH|14.06|100.65
Ādilābād|IN|19.67|78.54
Fargo|US|46.88|-96.79
Brugge|BE|51.21|3.22
Jhunjhunūn|IN|28.13|75.4
Iguala de la Independencia|MX|18.34|-99.54
Sarandi|BR|-23.44|-51.87
Zomba|MW|-15.39|35.32
Sepatan|ID|-6.12|106.58
Malita|PH|6.42|125.61
Zielona Góra|PL|51.94|15.51
Luodian|CN|31.42|121.33
Jetpur|IN|21.75|70.62
Tsentralno-Miskyi|UA|48.3|38.03
Uppal Kalan|IN|17.41|78.56
São Lourenço da Mata|BR|-8|-35.02
Maghāghah|EG|28.65|30.84
Pita Kotte|LK|6.89|79.9
Guiguinto|PH|14.83|120.88
Gudivāda|IN|16.44|81
Setúbal|PT|38.52|-8.89
Torrejón de Ardoz|ES|40.46|-3.47
Aizu-Wakamatsu|JP|37.49|139.95
Bama|NG|11.52|13.69
Ilobu|NG|7.84|4.49
Manolo Fortich|PH|8.37|124.86
Itabira|BR|-19.62|-43.23
Kiến An|VN|20.81|106.63
Jandira|BR|-23.53|-46.9
Guaratinguetá|BR|-22.82|-45.19
San Rafael|AR|-34.62|-68.33
Shaoshan|CN|27.92|112.52
Troparëvo|RU|55.66|37.48
Bārān|IN|25.1|76.52
Narmadapuram|IN|22.75|77.73
Amreli|IN|21.6|71.21
Nakhon Pathom|TH|13.82|100.04
Manfalūţ|EG|27.31|30.97
Kakegawa|JP|34.77|138.02
Handa|JP|34.88|136.93
Wushan|CN|31.08|109.88
Friedrichshain|DE|52.52|13.45
Abomey|BJ|7.18|1.99
Sokodé|TG|8.98|1.13
Araguari|BR|-18.65|-48.19
Tarnów|PL|50.01|20.99
Bangkok Noi|TH|13.76|100.48
Jalingo|NG|8.89|11.36
Raposo Tavares|BR|-23.59|-46.79
Saanich|CA|48.55|-123.37
Ibanda|UG|-0.13|30.5
Bairro da Penha|BR|-23.37|-46.31
Nyíregyháza|HU|47.96|21.72
Sano|JP|36.32|139.58
Karatsu|JP|33.44|129.97
Achinsk|RU|56.27|90.5
Pudukkottai|IN|10.38|78.82
Shunyi|CN|40.12|116.65
Rotherham|GB|53.43|-1.36
Ciudad de Villa de Álvarez|MX|19.27|-103.74
Rouiba|DZ|36.74|3.28
Banyuwangi|ID|-8.23|114.36
Tebingtinggi|ID|3.33|99.16
Tigwav|HT|18.43|-72.87
Narasaraopet|IN|16.23|80.05
Lisala|CD|2.15|21.52
Badin|PK|24.66|68.84
Banfora|BF|10.64|-4.75
Punta Arenas|CL|-53.16|-70.91
Kadoma|ZW|-18.33|29.92
Midsayap|PH|7.19|124.53
Camboriú|BR|-27.03|-48.65
Pyin Oo Lwin|MM|22.04|96.46
Clearwater|US|27.97|-82.8
Himamaylan|PH|10.1|122.87
Independence|US|39.09|-94.42
Heroica Guaymas|MX|27.92|-110.9
Kedungwuni|ID|-6.97|109.65
Ilebo|CD|-4.33|20.59
Kristiansand|NO|58.15|8
Longjing|CN|42.77|129.42
Kroonstad|ZA|-27.65|27.23
Remscheid|DE|51.18|7.19
Billings|US|45.78|-108.5
Möng Yang|MM|21.85|99.68
Čačak|RS|43.89|20.35
Ann Arbor|US|42.28|-83.74
Los Baños|PH|14.17|121.24
Duekoué|CI|6.74|-7.35
Higashikurume|JP|35.75|139.51
Rishra|IN|22.72|88.35
Pinhais|BR|-25.44|-49.19
Kyzyl|RU|51.71|94.44
Cadiz|ES|36.53|-6.29
Dąbrowa Górnicza|PL|50.33|19.2
Passos|BR|-20.72|-46.61
Fāqūs|EG|30.73|31.8
Tacurong|PH|6.69|124.68
Hōfu|JP|34.05|131.57
Gabela|AO|-10.85|14.38
Serangoon|SG|1.36|103.9
Serangoon New Town|SG|1.35|103.87
Funza|CO|4.72|-74.21
Merauke|ID|-8.5|140.41
Baripāda|IN|21.93|86.73
Kōnosu|JP|36.07|139.52
Soreang|ID|-7.03|107.52
Smolyanskyi|UA|48.01|37.74
Noord|NL|52.39|4.91
Dinaig|PH|7.17|124.21
Manp’o|KP|41.15|126.29
Muktsar|IN|30.47|74.52
El Monte|US|34.07|-118.03
Tubarão|BR|-28.47|-49.01
Forlì|IT|44.22|12.04
Azamgarh|IN|26.07|83.18
Santa Maria|BR|-16.03|-48.03
Masaka|UG|-0.33|31.73
Cờ Đỏ|VN|10.09|105.43
Taldykorgan|KZ|45.02|78.37
Moncloa-Aravaca|ES|40.44|-3.73
Gulin|CN|28.04|105.81
Al Majaz|AE|25.32|55.39
Thung Khru|TH|13.63|100.51
Barnāla|IN|30.37|75.55
Yelahanka|IN|13.1|77.6
Pattaya|TH|12.93|100.88
Chittorgarh|IN|24.89|74.62
Chenggu|CN|33.15|107.33
Harlem|US|40.81|-73.95
Orléans|FR|47.9|1.9
Rouen|FR|49.44|1.1
Tinsukia|IN|27.49|95.36
Westminster|US|39.84|-105.04
Dasha|CN|23.11|113.44
Yakeshi|CN|49.28|120.73
Ipiranga|BR|-23.6|-46.62
Makumbako|TZ|-8.85|34.83
Khargone|IN|21.82|75.61
Mariara|VE|10.3|-67.72
Digos|PH|6.75|125.36
Tshilenge|CD|-10.97|22.9
Aïn Beïda|DZ|35.8|7.39
Shahre Jadide Andisheh|IR|35.68|51.02
Andīsheh|IR|35.75|51.28
Breves|BR|-1.68|-50.48
Alcobendas|ES|40.55|-3.64
Kissidougou|GN|9.18|-10.1
San Tung Chung Hang|HK|22.28|113.94
Taganskiy|RU|55.73|37.67
Round Rock|US|30.51|-97.68
Noginsk|RU|55.86|38.45
Tinaquillo|VE|9.92|-68.3
Wilmington|US|34.24|-77.95
Cavite City|PH|14.48|120.9
Campo Grande|BR|-23.67|-46.69
East Harlem|US|40.79|-73.94
Formosa|BR|-15.54|-47.33
Tandil|AR|-37.33|-59.14
Zoetermeer|NL|52.06|4.49
São Gonçalo do Amarante|BR|-5.79|-35.33
Sri Jayewardenepura Kotte|LK|6.88|79.91
Nasushiobara|JP|36.98|140.07
Várzea Paulista|BR|-23.21|-46.83
Baisha|CN|29.06|106.12
Banī Mazār|EG|28.49|30.81
Taunsa|PK|30.7|70.65
Urasoe|JP|26.26|127.73
Santana|BR|-23.49|-46.64
Yelets|RU|52.61|38.51
Suan Luang|TH|13.73|100.65
Parla|ES|40.24|-3.77
Mỹ Hào|VN|20.92|106.08
Anliu|CN|23.7|115.68
Ribeirão Pires|BR|-23.71|-46.41
Recanto das Emas|BR|-15.91|-48.06
Chunga|ZM|-15.32|28.27
Bīshah|SA|20|42.61
Novo-Peredelkino|RU|55.65|37.34
Baidyabāti|IN|22.78|88.33
Okigwe|NG|5.83|7.35
Ar Rifā‘|BH|26.13|50.56
Uzhhorod|UA|48.62|22.29
Kasese|UG|0.18|30.08
Tianfu|CN|37.26|122.05
Arvada|US|39.8|-105.09
Otaru|JP|43.19|141
Tayabas|PH|14.03|121.59
Inkisi|CD|-5.13|15.05
Iriga City|PH|13.43|123.41
Thornhill|CA|43.82|-79.42
Vacoas|MU|-20.3|57.48
Beaumont|US|30.09|-94.1
Vlorë|AL|40.47|19.48
Sanxia|TW|24.93|121.37
Provo|US|40.23|-111.66
Tucuruí|BR|-3.77|-49.68
Bastī|IN|26.79|82.72
Peoria|US|40.69|-89.59
Ezeiza|AR|-34.85|-58.52
Lasnamäe|EE|59.43|24.86
Xiva|UZ|41.39|60.36
Amasya|TR|40.65|35.83
Mendoza|AR|-32.89|-68.85
Balkh|AF|36.76|66.9
Cubatão|BR|-23.89|-46.43
Mingshui|CN|36.72|117.5
Vila Medeiros|BR|-23.49|-46.58
Phong Điền|VN|16.58|107.36
Nova Serrana|BR|-19.88|-44.98
Wang Thonglang|TH|13.79|100.61
Carlsbad|US|33.16|-117.35
Mandera|KE|3.94|41.86
Qiaotou|CN|36.94|101.67
Gyumri|AM|40.79|43.85
Silopi|TR|37.24|42.46
Gangavati|IN|15.43|76.53
Ambur|IN|12.79|78.72
Tangará da Serra|BR|-14.62|-57.49
Gorzów Wielkopolski|PL|52.73|15.23
Simões Filho|BR|-12.78|-38.4
Giridih|IN|24.19|86.31
Phool Nagar|PK|31.2|73.95
Quezon|PH|7.73|125.1
Aryanah|TN|36.86|10.19
Tungipara|BD|22.9|89.9
Ichinoseki|JP|38.92|141.13
Khenchela|DZ|35.44|7.14
Khon Kaen|TH|16.45|102.83
Odessa|US|31.85|-102.37
Catalão|BR|-18.17|-47.95
Tando Muhammad Khan|PK|25.12|68.54
Springfield|US|39.8|-89.64
Somaroboro|ZA|-25.35|28.83
Guadalajara de Buga|CO|3.9|-76.3
Pamanukan|ID|-6.28|107.81
Codó|BR|-4.46|-43.89
Pardīs|IR|35.75|51.81
Pleiku|VN|13.98|108
Downey|US|33.94|-118.13
Lower Hutt|NZ|-41.22|174.92
Yuyao|CN|30.05|121.15
Rānyah|IQ|36.26|44.88
Hatsukaichi|JP|34.35|132.33
Tung Chung|HK|22.29|113.94
Salto|UY|-31.39|-57.96
Siirt|TR|37.93|41.94
Korolyov|UA|50.24|28.7
Zhaozhou|CN|45.71|125.27
Villa Lugano|AR|-34.68|-58.47
Ochakovo-Matveyevskoye|RU|55.68|37.45
Punta Cardón|VE|11.66|-70.21
Akishima|JP|35.72|139.38
Itacoatiara|BR|-3.14|-58.44
Chililabombwe|ZM|-12.36|27.82
Rivière-des-Prairies–Pointe-aux-Trembles|CA|45.64|-73.58
Worthing|GB|50.82|-0.38
Navojoa|MX|27.07|-109.44
Offa|NG|8.15|4.72
Tobolsk|RU|58.2|68.25
Tōkai|JP|35.02|136.91
Wardha|IN|20.74|78.6
Wansheng|CN|28.96|106.93
Pattoki|PK|31.02|73.85
Wayaobu|CN|37.14|109.66
Hikone|JP|35.25|136.25
Nagahama|JP|35.38|136.27
Pingshan|CN|22.99|114.71
Songyuan|CN|45.13|124.83
Maba|CN|24.68|113.6
Fujimino|JP|35.9|139.52
Doncaster|GB|53.52|-1.13
Bình Thủy|VN|10.07|105.74
Dumaguete|PH|9.31|123.31
Budapest XIII. kerület|HU|47.53|19.08
Nippes|DE|50.97|6.95
Jaén|ES|37.77|-3.79
Chengqiao|CN|31.63|121.39
Chorzów|PL|50.31|18.97
Porz am Rhein|DE|50.89|7.06
Louga|SN|15.62|-16.22
Elmhurst|US|40.74|-73.88
Hoàng Mai|VN|19.27|105.72
Yaritagua|VE|10.08|-69.12
Shahdadpur|PK|25.93|68.62
Itumbiara|BR|-18.42|-49.22
Khwisero|KE|0.17|34.59
Costa Mesa|US|33.64|-117.92
Jauharabad|PK|32.29|72.28
Miami Gardens|US|25.94|-80.25
Bagrām|AF|34.97|69.27
Chesterfield|GB|53.25|-1.42
North Peoria|US|40.72|-89.58
Shchyolkovo|RU|55.92|37.97
Al Fashn|EG|28.82|30.9
Fairfield|US|38.25|-122.04
Guanabacoa|CU|23.13|-82.3
Hammanskraal|ZA|-25.41|28.29
Ōshū|JP|39.14|141.17
Taourirt|MA|34.41|-2.9
Ţalkhā|EG|31.05|31.38
Neili|TW|24.97|121.26
Vihari|PK|30.04|72.36
Taonan|CN|45.33|122.78
Youkaichi|JP|35.12|136.2
Kazo|JP|36.12|139.6
Santa Lucía Cotzumalguapa|GT|14.34|-91.02
Jönköping|SE|57.78|14.16
City of Port Phillip|AU|-37.83|144.94
Tadepalligudem|IN|16.81|81.53
Haikou|CN|24.78|102.58
Lansing|US|42.73|-84.56
Chanduasi|IN|28.45|78.78
Bagaha|IN|27.1|84.09
Nefteyugansk|RU|61.1|72.6
Reutlingen|DE|48.49|9.2
Bushwick|US|40.69|-73.92
Upata|VE|8.02|-62.41
Shaowu|CN|27.34|117.48
Mengmao|CN|24|97.86
Lawang|ID|-7.84|112.69
Bouskoura|MA|33.45|-7.65
Satu Mare|RO|47.8|22.86
Itanhaém|BR|-24.18|-46.79
Kaiyuan|CN|42.53|124.04
Kisii|KE|-0.68|34.77
Petržalka|SK|48.12|17.13
Kāzerūn|IR|29.62|51.65
Ermelino Matarazzo|BR|-23.49|-46.47
Achalpur|IN|21.26|77.51
Planaltina|BR|-15.45|-47.61
Guanare|VE|9.04|-69.73
Wuzhishan|CN|18.78|109.5
Gravesend|US|40.6|-73.97
Rochester|US|44.02|-92.47
Gondal|IN|21.96|70.8
Chichawatni|PK|30.53|72.69
Farīdpur|BD|23.61|89.84
Apopa|SV|13.81|-89.18
Carmona|PH|14.31|121.06
Laoag|PH|18.2|120.6
Elgin|US|42.04|-88.28
Dharashiv|IN|18.18|76.04
Xigang|CN|38.55|106.35
Chóngfú|CN|30.53|120.43
Taipa|MO|22.16|113.56
Port Blair|IN|11.67|92.75
Minatitlán|MX|18|-94.56
Esuk Oron|NG|4.8|8.25
Atbara|SD|17.7|33.99
Vicenza|IT|45.55|11.55
Ciudad Guzmán|MX|19.7|-103.46
Ballarat|AU|-37.57|143.85
Tocoa|HN|15.68|-86
West Jordan|US|40.61|-111.94
Bagalkot|IN|16.19|75.7
Lomas de Zamora|AR|-34.76|-58.4
Yeoju|KR|37.3|127.63
Dūmā|SY|33.57|36.4
Winterthur|CH|47.51|8.72
Novokuybyshevsk|RU|53.1|49.94
Bou Saâda|DZ|35.21|4.17
Abnūb|EG|27.27|31.15
Qūchān|IR|37.11|58.51
Manacapuru|BR|-3.3|-60.62
Kuningan|ID|-6.98|108.48
Suriāpet|IN|17.14|79.62
Kandy|LK|7.29|80.63
Zefta|EG|30.71|31.24
Bangaon|IN|23.05|88.83
Inglewood|US|33.96|-118.35
Kilis|TR|36.72|37.12
Terrebonne|CA|45.7|-73.65
Kyimyindine|MM|16.81|96.12
Set Ka Lay|MM|16.81|96.11
Chelmsford|GB|51.74|0.47
Marzahn|DE|52.55|13.57
Chiquimula|GT|14.8|-89.55
Cileunyi|ID|-6.94|107.75
Ashoknagar Kalyangarh|IN|22.86|88.64
Mongu|ZM|-15.25|23.13
Mulhouse|FR|47.75|7.33
Al Fqih Ben Çalah|MA|32.5|-6.69
Pulilan|PH|14.9|120.85
Beau Bassin-Rose Hill|MU|-20.23|57.47
Tuscaloosa|US|33.21|-87.57
Sogamoso|CO|5.71|-72.93
Sainte-Foy|CA|46.78|-71.29
Sainte-Foy–Sillery–Cap-Rouge|CA|46.76|-71.35
Mbale|UG|1.08|34.18
Montreuil|FR|48.86|2.44
Terni|IT|42.56|12.64
Deesa|IN|24.26|72.18
Navadwīp|IN|23.41|88.37
Maran|MY|3.59|102.77
Nandurbar|IN|21.37|74.24
Kasuga|JP|33.53|130.46
Nsukka|NG|6.86|7.4
Nguru|NG|12.88|10.46
Mabopane|ZA|-25.51|28.06
Namur|BE|50.47|4.87
Cambé|BR|-23.28|-51.28
Encheng|CN|22.19|112.3
Turhal|TR|40.39|36.08
Gò Vấp|VN|10.82|106.68
Richardson|US|32.95|-96.73
Bokhtar|TJ|37.84|68.78
Hadejia|NG|12.45|10.04
Zhuji|CN|29.72|120.24
Perpignan|FR|42.7|2.9
Lowell|US|42.63|-71.32
Lavras|BR|-21.25|-45
São Pedro da Aldeia|BR|-22.84|-42.1
East Independence|US|39.1|-94.36
Caen|FR|49.19|-0.36
Açailândia|BR|-4.95|-47.5
Kyivskyi|UA|49.61|34.53
Borāzjān|IR|29.27|51.22
Yenangyaung|MM|20.47|94.87
Gresham|US|45.5|-122.43
Antioch|US|38|-121.81
Paulínia|BR|-22.76|-47.15
Manzini|SZ|-26.5|31.38
St. John's|CA|47.56|-52.71
Delicias|ES|41.65|-0.91
Masindi|UG|1.67|31.72
Kfar Saba|IL|32.17|34.91
Matsutō|JP|36.52|136.57
Cambridge|US|42.38|-71.11
Sultānpur|IN|26.26|82.07
Delhi Cantonment|IN|28.6|77.13
Firozpur|IN|30.93|74.61
Bayugan|PH|8.76|125.77
High Point|US|35.96|-80.01
Datun|CN|34.81|116.9
Manchester|US|43|-71.45
Bāneh|IR|36|45.89
Gulshan|BD|23.79|90.41
Geylang|SG|1.32|103.89
Kresek|ID|-6.13|106.38
Bender|MD|46.83|29.48
Mbombela|ZA|-25.48|30.97
Rodenkirchen|DE|50.89|6.99
Sembawang Estate|SG|1.45|103.83
Gabès|TN|33.88|10.1
Orkney|ZA|-26.98|26.67
Qingnian|CN|36.84|115.71
Temecula|US|33.49|-117.15
Lucapa|AO|-8.42|20.74
Mendip|GB|51.24|-2.63
Qal‘at Sukkar|IQ|31.86|46.07
An Nu‘mānīyah|IQ|32.56|45.41
Kufa|IQ|32.05|44.44
Ressano Garcia|MZ|-25.44|32
Noyabrsk|RU|63.19|75.44
Sengerema|TZ|-2.67|32.65
Bataysk|RU|47.14|39.76
Pisa|IT|43.71|10.4
Linshui|CN|36.42|114.2
Kamagaya|JP|35.77|140
Sutton Coldfield|GB|52.57|-1.82
Hailun|CN|47.45|126.92
Maramag|PH|7.76|125.01
Kecskemét|HU|46.91|19.69
Seversk|RU|56.6|84.89
Ciamis|ID|-7.33|108.35
Murrieta|US|33.55|-117.21
Brovary|UA|50.51|30.79
Santo Antônio de Jesus|BR|-12.97|-39.26
Lak Si|TH|13.89|100.58
Wakefield|GB|53.68|-1.5
Centennial|US|39.58|-104.88
Shilong|CN|23.11|113.85
Richmond|US|37.94|-122.35
Corona|US|40.75|-73.86
Thới Lai|VN|10.07|105.56
Vilhena|BR|-12.74|-60.15
Pandit Deen Dayal Upadhyaya Nagar|IN|25.28|83.12
Dchira El Jihadia|MA|30.37|-9.55
Didao|CN|45.35|130.84
Arsuz|TR|36.41|35.89
Pelabuhanratu|ID|-6.99|106.55
Marugame|JP|34.28|133.78
Habikino|JP|34.55|135.59
Arzamas|RU|55.4|43.84
Phalaborwa|ZA|-23.94|31.14
Walthamstow|GB|51.59|-0.02
Pueblo|US|38.25|-104.61
Guaianases|BR|-23.54|-46.41
Ijebu-Igbo|NG|6.97|4
Sergiyev Posad|RU|56.31|38.14
Talisay|PH|10.74|122.97
San Juan|AR|-31.54|-68.53
Sehore|IN|23.2|77.08
Jianchang|CN|27.56|116.64
Hulan|CN|45.89|126.58
Matagalpa|NI|12.93|-85.92
Khlong Toei|TH|13.71|100.58
Leninsk-Kuznetsky|RU|54.66|86.17
Kiryū|JP|36.4|139.33
Handeni|TZ|-5.43|38.02
Balombo|AO|-12.35|14.77
Thunder Bay|CA|48.38|-89.25
Iwatsuki|JP|35.96|139.7
Pearland|US|29.56|-95.29
Dehui|CN|44.54|125.69
Pangkalanbuun|ID|-2.68|111.63
Waterbury|US|41.56|-73.05
Greeley|US|40.42|-104.71
Boulogne-Billancourt|FR|48.84|2.24
Warīsān|AE|25.17|55.41
Kalisz|PL|51.76|18.09
Baia Mare|RO|47.66|23.57
Coronel Fabriciano|BR|-19.52|-42.63
Mascara|DZ|35.4|0.14
Maranguape|BR|-3.89|-38.69
Uromi|NG|6.7|6.33
Katumba|TZ|-9.23|33.62
Móng Cái|VN|21.52|107.97
Vila Maria|BR|-23.51|-46.59
Kanpur Cantonment|IN|26.46|80.38
Komatsu|JP|36.4|136.45
West Covina|US|34.07|-117.94
Enterprise|US|36.03|-115.24
Bānsbāria|IN|22.95|88.4
Girón|CO|7.07|-73.17
Baghlān|AF|36.13|68.71
Muriaé|BR|-21.13|-42.37
Hanjia|CN|29.3|108.16
Trincomalee|LK|8.58|81.23
La Cité-Limoilou|CA|46.83|-71.23
Santiago|PH|16.69|121.55
Taibai|CN|30.82|108.36
Vedado|CU|23.14|-82.39
Dagenham|GB|51.55|0.17
Xuyong|CN|28.17|105.43
North Charleston|US|32.85|-79.97
Sohar|OM|24.35|56.71
Nehe|CN|48.48|124.87
Abu Gharaq|IQ|32.53|44.34
Oktyabrsky|RU|54.48|53.47
Tadpatri|IN|14.91|78.01
Birnin Kebbi|NG|12.45|4.2
Santa Cruz|PH|14.28|121.42
Novobavarskyi|UA|49.95|36.16
Everett|US|47.98|-122.2
An Nuhūd|SD|12.7|28.43
Ŭllyul|KP|38.51|125.19
Rijeka|HR|45.33|14.44
Douliu|TW|23.71|120.54
Luis Eduardo Magalhães|BR|-12.09|-45.79
Catbalogan|PH|11.78|124.89
College Station|US|30.63|-96.33
As Salţ|JO|32.04|35.73
Mishima|JP|35.12|138.92
Baía Farta|AO|-12.6|13.2
Jalpāiguri|IN|26.52|88.73
Jalai Nur|CN|49.45|117.7
Tajimi|JP|35.32|137.13
Castelar|AR|-34.65|-58.64
Pompano Beach|US|26.24|-80.12
Coronel|CL|-37.03|-73.14
Bacabal|BR|-4.23|-44.78
Novo Gama|BR|-16.06|-48.04
Dusit|TH|13.78|100.52
Mandurah|AU|-32.53|115.72
Basingstoke|GB|51.26|-1.09
Bandırma|TR|40.35|27.98
Maidstone|GB|51.27|0.52
Tieli|CN|46.98|128.05
Umm Qaşr|IQ|30.04|47.92
Butterworth|MY|5.4|100.36
Shaping|CN|22.77|112.96
Labé|GN|11.32|-12.28
Chālūs|IR|36.66|51.42
Koszalin|PL|54.19|16.17
Bolzano|IT|46.49|11.34
South Fulton|US|33.59|-84.67
Ubá|BR|-21.12|-42.94
Sherpur|BD|25.02|90.02
Obninsk|RU|55.11|36.61
Circoiscrizione VI|IT|45.1|7.7
Girardot City|CO|4.3|-74.81
Koblenz|DE|50.35|7.58
Itaperuna|BR|-21.2|-41.89
Siegen|DE|50.87|8.02
Hirnytskyi|UA|48.02|37.97
Mangalagiri|IN|16.43|80.57
Thohoyandou|ZA|-22.95|30.48
As Suwayq|OM|23.85|57.44
Norwalk|US|33.9|-118.08
Yên Vinh|VN|18.67|105.67
Mitrovicë|XK|42.88|20.87
Yevpatoriya|UA|45.2|33.37
Pati|ID|-6.76|111.04
Elista|RU|46.31|44.26
Dera Murad Jamali|PK|28.55|68.22
Taungoo|MM|18.94|96.43
Bedford|GB|52.13|-0.47
Bagong Silangan|PH|14.71|121.11
Kangnyŏng|KP|37.91|125.51
Catia La Mar|VE|10.61|-67.03
Boulder|US|40.01|-105.27
Anning|CN|24.92|102.48
Ituiutaba|BR|-18.97|-49.46
Rayong|TH|12.68|101.26
Sirte|LY|31.21|16.59
Kotri|PK|25.37|68.31
Cherëmushki|RU|55.66|37.56
Broken Arrow|US|36.05|-95.79
Daly City|US|37.71|-122.46
Cikarang|ID|-6.26|107.15
Arlit|NE|18.74|7.39
Bahārestān|IR|32.49|51.77
Ba Đồn|VN|17.75|106.42
Ranebennur|IN|14.62|75.63
Longjiang|CN|47.34|123.2
Hwado|KR|37.65|127.31
Buhe|CN|30.29|112.23
Hammamet|TN|36.4|10.62
Pindiga|NG|9.98|10.95
Berdyansk|UA|46.76|36.79
Toufen|TW|24.69|120.91
Mīāneh|IR|37.42|47.72
Dakhla|EH|23.68|-15.96
Paniqui|PH|15.67|120.58
Novotroitsk|RU|51.2|58.31
Bergisch Gladbach|DE|50.99|7.13
Rangamati|BD|22.64|92.19
Alchevsk|UA|48.47|38.8
Sơn La|VN|21.33|103.92
Mingachevir|AZ|40.76|47.06
Legnica|PL|51.21|16.16
Drammen|NO|59.74|10.2
Pare|ID|-7.77|112.2
Tokoza|ZA|-26.36|28.13
Balsas|BR|-7.53|-46.04
Sydney|CA|46.14|-60.18
Derbent|RU|42.07|48.29
Xinghua|CN|32.94|119.83
Khurja|IN|28.25|77.86
Mati|PH|6.96|126.22
Arjawinangun|ID|-6.65|108.41
Le Plateau-Mont-Royal|CA|45.53|-73.58
Funchal|PT|32.67|-16.93
Kishanganj|IN|26.1|87.96
Yautepec|MX|18.88|-99.07
Jataí|BR|-17.88|-51.72
Sergeli|UZ|41.2|69.22
Azare|NG|11.67|10.19
Nantou|TW|23.92|120.66
Ipojuca|BR|-8.4|-35.06
Lahad Datu|MY|5.02|118.33
Vila Prudente|BR|-23.59|-46.57
Subulussalam|ID|2.66|97.88
Paragominas|BR|-3|-47.35
Bukama|CD|-9.2|25.85
Ponnāni|IN|10.77|75.93
Tanza|PH|14.68|120.94
Inzai|JP|35.83|140.16
Bhairab Bāzār|BD|24.05|90.98
Hindaun|IN|26.73|77.04
Jamālpur|IN|25.31|86.49
Abū Tīj|EG|27.05|31.32
Coatepeque|GT|14.7|-91.86
Baraki|DZ|36.67|3.1
Robāţ Karīm|IR|35.48|51.08
'Ākra|IQ|36.73|43.88
Sandy Springs|US|33.92|-84.38
Burbank|US|34.18|-118.31
Taling Chan|TH|13.78|100.46
San Justo|AR|-34.68|-58.56
Hòa Bình|VN|20.82|105.34
Saint-Paul|RE|-21.01|55.27
Ourense|ES|42.34|-7.86
Nāgaur|IN|27.2|73.73
Riacho Fundo II|BR|-15.9|-48.05
Green Bay|US|44.52|-88.02
Mityana|UG|0.42|32.02
Jizan|SA|16.89|42.55
Texcoco de Mora|MX|19.51|-98.88
Bang Bon|TH|13.66|100.4
Nikopol|UA|47.57|34.39
Slovyansk|UA|48.85|37.6
Santa Maria|US|34.95|-120.44
San Francisco De Borja|PE|-12.09|-77
Yidu|CN|36.77|118.42
Nancy|FR|48.68|6.18
Kuala Krai|MY|5.53|102.2
Zhonghe|CN|28.45|108.99
Universal City|US|34.14|-118.35
Puyang Chengguanzhen|CN|35.71|115.03
Ikeda|JP|34.82|135.43
Waterloo|CA|43.47|-80.52
Ambala Sadar|IN|30.34|76.86
Chinautla|GT|14.7|-90.5
Salzgitter|DE|52.16|10.42
Ville-Marie|CA|45.5|-73.57
Moratalaz|ES|40.41|-3.65
Bhiwadi|IN|28.21|76.86
Būndi|IN|25.44|75.64
Miryalaguda|IN|16.87|79.56
Daxing|CN|39.74|116.33
Artur Alvim|BR|-23.54|-46.49
Assis|BR|-22.66|-50.41
Santa Cruz do Capibaribe|BR|-7.96|-36.2
Yezhou|CN|30.6|109.72
Hidalgo del Parral|MX|26.93|-105.67
Saijō|JP|33.92|133.18
Jena|DE|50.93|11.59
Wichita Falls|US|33.91|-98.49
Brantford|CA|43.13|-80.27
Gera|DE|50.88|12.08
Tuyên Quang|VN|21.82|105.21
Ottakring|AT|48.22|16.3
Al Fāw|IQ|29.97|48.47
Angoche|MZ|-16.23|39.91
Depok|ID|-7.76|110.43
Toride|JP|35.9|140.08
Mostar|BA|43.34|17.81
Mazyr|BY|52.04|29.22
Kamloops|CA|50.67|-120.32
Mazabuka|ZM|-15.86|27.75
Lakeland|US|28.04|-81.95
Pozniaky|UA|50.4|30.62
Zhezqazghan|KZ|47.79|67.71
Pailou|CN|30.8|108.39
Lo Prado|CL|-33.44|-70.73
Tizi Ouzou|DZ|36.71|4.05
Pulandian|CN|39.4|121.97
Helsingborg|SE|56.05|12.69
Abreu e Lima|BR|-7.91|-34.9
Kot Addu|PK|30.47|70.97
Bouaflé|CI|6.99|-5.74
Kara|TG|9.55|1.19
Clovis|US|36.83|-119.7
Kafue|ZM|-15.77|28.18
Campo Mourão|BR|-24.04|-52.38
Salaqi|CN|40.54|110.51
Kalulushi|ZM|-12.84|28.09
Lewisville|US|33.05|-96.99
Oued Zem|MA|32.86|-6.57
Weldiya|ET|11.83|39.59
Soyībug|IN|34.08|74.71
Izmaylovo|RU|55.8|37.78
Kiselëvsk|RU|53.99|86.66
Jishu|CN|44.32|126.8
El Kelaa des Srarhna|MA|32.05|-7.41
Séguéla|CI|7.96|-6.67
Ourinhos|BR|-22.98|-49.87
Totonicapán|GT|14.91|-91.36
Ad-Damir|SD|17.6|33.97
Jagtiāl|IN|18.79|78.92
Woking|GB|51.32|-0.56
Roorkee|IN|29.87|77.89
Edéa|CM|3.8|10.13
Yuxi|CN|24.36|102.54
Lincoln|GB|53.23|-0.54
Poá|BR|-23.53|-46.34
Bashan|CN|27.77|116.05
Nkpor|NG|6.15|6.83
Berbérati|CF|4.26|15.79
Sangla Hill|PK|31.72|73.38
Tongren|CN|35.51|102.02
Tyler|US|32.35|-95.3
Male|MV|4.18|73.51
El Cajon|US|32.79|-116.96
Mandaqui|BR|-23.46|-46.64
Piacenza|IT|45.05|9.69
Gardez|AF|33.6|69.23
Zhanaozen|KZ|43.34|52.86
Gangu Chengguanzhen|CN|34.74|105.33
Teziutlan|MX|19.82|-97.36
Kolda|SN|12.89|-14.94
Vila Matilde|BR|-23.54|-46.52
Udgīr|IN|18.39|77.12
San Mateo|US|37.56|-122.33
Viseu|PT|40.66|-7.91
Nagda|IN|23.46|75.42
Moers|DE|51.45|6.63
Brandon|US|27.94|-82.29
Buzău|RO|45.15|26.83
Reus|ES|41.16|1.11
Prabumulih|ID|-3.43|104.23
Itabaiana|BR|-10.68|-37.43
Francistown|BW|-21.17|27.51
Isehara|JP|35.4|139.31
Queluz|PT|38.76|-9.25
Betūl|IN|21.9|77.9
Chikushino-shi|JP|33.5|130.52
Akademicheskoe|RU|60.01|30.39
Turgutlu|TR|38.5|27.7
Lida|BY|53.88|25.3
Taitung|TW|22.76|121.14
Kalynivskyi|UA|48.01|37.85
San|ML|13.3|-4.9
Jahānābād|IN|25.21|84.99
Lethbridge|CA|49.7|-112.82
Cursino|BR|-23.63|-46.62
Velikiye Luki|RU|56.34|30.54
Kashipur|IN|29.21|78.96
Rialto|US|34.11|-117.37
West Bromwich|GB|52.52|-1.99
Ghazīpur|IN|25.58|83.59
Tanjung Pandan|ID|-2.73|107.63
Ikere-Ekiti|NG|7.5|5.23
Hildesheim|DE|52.15|9.95
Kharian|PK|32.82|73.89
Bendigo|AU|-36.76|144.28
Rantauprapat|ID|2.1|99.83
Chumakivskyi|UA|47.96|37.94
Nkayi|CG|-4.18|13.29
Amaravati|IN|16.51|80.52
Bogorodskoye|RU|55.81|37.72
Pārsābād|IR|39.65|47.92
Lahān|NP|26.72|86.48
Liberec|CZ|50.77|15.06
Nagapattinam|IN|10.76|79.84
Qurayyat|SA|31.33|37.34
Buxar|IN|25.58|83.98
Portmore|JM|17.97|-76.89
Santa Rosa|AR|-36.62|-64.29
Palma Soriano|CU|20.21|-75.99
Pushkino|RU|55.99|37.83
Khushāb|PK|32.3|72.35
Lafiagi|NG|8.85|5.42
Caieiras|BR|-23.36|-46.74
Xincheng|CN|41.71|82.93
Lyon 03|FR|45.76|4.85
Pasrur|PK|32.26|74.66
Belawan|ID|3.78|98.68
Pano Aqil|PK|27.86|69.11
Piatra Neamţ|RO|46.92|26.33
Cabudare|VE|10.03|-69.26
Erlangen|DE|49.59|11.01
Tepexpan|MX|19.61|-98.94
Tivaouane|SN|14.95|-16.82
Entebbe|UG|0.06|32.48
Davenport|US|41.52|-90.58
Darnah|LY|32.77|22.64
Dayrūţ|EG|27.56|30.81
Whalley|CA|49.18|-122.87
Edison|US|40.52|-74.41
Skhidni Kvartaly|UA|48.57|39.38
Curicó|CL|-34.98|-71.24
Kangsŏn|KP|38.94|125.58
La Vega|DO|19.22|-70.53
Shāhzādpur|BD|24.18|89.6
Tulancingo|MX|20.08|-98.37
Perdizes|BR|-23.54|-46.68
Yono|JP|35.88|139.63
Apatzingán|MX|19.09|-102.36
Ciutat Vella|ES|41.38|2.17
Hillsboro|US|45.52|-122.99
Mormugao|IN|15.39|73.81
Seoni|IN|22.09|79.55
Shabqadar|PK|34.22|71.55
Mitte|DE|52.52|13.4
Sabanalarga|CO|10.63|-74.92
Jishou|CN|28.32|109.73
Ngong|KE|-1.35|36.67
Francisco Beltrão|BR|-26.08|-53.05
Sebeta|ET|8.92|38.62
Artëm|RU|43.36|132.19
Tsuyama|JP|35.05|134
Limerick|IE|52.66|-8.62
Aurangābād|IN|24.75|84.37
Lampa|CL|-33.29|-70.88
Sungai Penuh|ID|-2.06|101.39
Ukhta|RU|63.57|53.69
Japeri|BR|-22.64|-43.65
Nakhon Si Thammarat|TH|8.43|99.97
Putatan|PH|14.4|121.05
Shuifu|CN|28.63|104.41
Kani|JP|35.4|137.06
Ōnojō|JP|33.54|130.48
Kot Radha Kishan|PK|31.17|74.1
Al Jumayl|LY|32.85|12.06
Shchukino|RU|55.8|37.45
Brateyevo|RU|55.64|37.76
Maldonado|UY|-34.9|-54.95
Venlo|NL|51.37|6.17
Mairiporã|BR|-23.32|-46.59
Novara|IT|45.45|8.62
Shūshtar|IR|32.05|48.85
Wilmersdorf|DE|52.48|13.32
Al-Musayab|IQ|32.78|44.29
Pôr do Sol|BR|-15.86|-48.12
Parintins|BR|-2.63|-56.74
Hedong|CN|23.92|115.78
Hinganghāt|IN|20.55|78.84
Zonguldak|TR|41.45|31.79
Iğdır|TR|39.92|44.05
Kawachi-Nagano|JP|34.44|135.58
Eastbourne|GB|50.77|0.28
Dhamtari|IN|20.71|81.55
Delta|CA|49.09|-123.05
Orsha|BY|54.51|30.4
Worcester|GB|52.19|-2.22
Las Cruces|US|32.31|-106.78
Székesfehérvár|HU|47.19|18.41
Lagarto|BR|-10.92|-37.65
Kindrativskyi|UA|48.3|38.05
Bath|GB|51.38|-2.36
Sidi Slimane|MA|34.26|-5.93
Leme|BR|-22.19|-47.39
Iida|JP|35.52|137.82
Los Puertos de Altagracia|VE|10.71|-71.52
South Bend|US|41.68|-86.25
Kansk|RU|56.2|95.72
Kalmiuskyi|UA|47.11|37.54
Chilliwack|CA|49.17|-121.95
Queenstown Estate|SG|1.29|103.8
Argenteuil|FR|48.95|2.25
Khanty-Mansiysk|RU|61|69.03
Isulan|PH|6.63|124.61
Itaim Bibi|BR|-23.59|-46.68
Mbaké|SN|14.79|-15.91
Pavlohrad|UA|48.53|35.87
Simmering|AT|48.18|16.43
Mustafakemalpaşa|TR|40.04|28.41
Burayu|ET|9.04|38.66
Chilakalūrupet|IN|16.09|80.17
Malappuram|IN|11.04|76.08
Ébolowa|CM|2.9|11.15
Dartmouth|CA|44.67|-63.58
Orihuela|ES|38.08|-0.94
Kallang|SG|1.33|103.87
Sangju|KR|36.42|128.16
Perling|MY|1.48|103.68
Albany|US|42.65|-73.76
São Cristóvão|BR|-11.01|-37.21
Medina Estates|GH|5.67|-0.16
Chakwal|PK|32.93|72.85
Ngã Bảy|VN|9.81|105.82
Gillingham|GB|51.39|0.55
Suruç|TR|36.98|38.43
Huacheng|CN|24.07|115.61
Ocaña|CO|8.24|-73.36
Hồng Ngự|VN|10.8|105.35
Daoukro|CI|7.06|-3.96
Tokuyama|JP|34.05|131.82
Ţimā|EG|26.91|31.43
Donghae City|KR|37.54|129.11
Standerton|ZA|-26.93|29.24
Kanoya|JP|31.38|130.85
Mokopane|ZA|-24.19|29.01
Dikirnis|EG|31.09|31.59
New Bedford|US|41.64|-70.93
Lāhījān|IR|37.2|50.01
Leuven|BE|50.88|4.7
Mezhdurechensk|RU|53.69|88.06
Bānswāra|IN|23.54|74.44
Jolo|PH|6.05|121
Ryazanskiy|RU|55.73|37.77
Novyye Cherëmushki|RU|55.7|37.58
Elbasan|AL|41.11|20.08
Pechersk|UA|50.44|30.52
Ijok|MY|3.32|101.4
Vista|US|33.2|-117.24
Davie|US|26.06|-80.23
Errachidia|MA|31.93|-4.43
Twifu Praso|GH|5.61|-1.55
Red Deer|CA|52.27|-113.8
Solikamsk|RU|59.67|56.74
El Progreso|HN|15.4|-87.8
Chirmiri|IN|23.19|82.35
Barra do Piraí|BR|-22.47|-43.83
Chikusei|JP|36.32|139.98
Sungailiat|ID|-1.85|106.12
Arezzo|IT|43.46|11.88
Újpest|HU|47.57|19.08
Calasiao|PH|16.01|120.36
Glazov|RU|58.14|52.66
Rosarito|MX|32.36|-117.05
Kallithéa|GR|37.95|23.7
Ahar|IR|38.48|47.07
Juan Díaz|PA|9.04|-79.44
Yên Bái|VN|21.72|104.91
Grogol|ID|-7.6|110.82
Nāḩiyat al Iskandarīyah|IQ|32.89|44.35
Puerto Barrios|GT|15.73|-88.6
Bakwa|CD|4.13|27.4
Itārsi|IN|22.61|77.76
Chinatown|US|37.8|-122.41
Votuporanga|BR|-20.42|-49.97
Si Maha Phot|TH|13.97|101.51
Hà Tiên|VN|10.38|104.49
Oleksiyivka|UA|50.05|36.19
Masjed Soleymān|IR|31.94|49.3
Los Rastrojos|VE|10.03|-69.24
Vasco da Gama|IN|15.4|73.82
Barakaldo|ES|43.3|-2.99
Oleksandrivskyi|UA|47.97|37.8
Ermelo|ZA|-26.53|29.98
Klagenfurt am Wörthersee|AT|46.62|14.31
Linxi|CN|39.71|118.45
Tiébo|SN|14.63|-16.23
Gangtok|IN|27.33|88.61
Datia|IN|25.67|78.46
Sakado|JP|35.96|139.39
Sakata|JP|38.92|139.85
Ust’-Ilimsk|RU|58|102.66
Girona|ES|41.98|2.82
Renton|US|47.48|-122.22
Chust|UZ|41|71.24
Kalmunai|LK|7.41|81.83
Udine|IT|46.07|13.24
Xinzhai|CN|36.4|118.62
Phagwāra|IN|31.22|75.77
Izumisano|JP|34.42|135.32
Trier|DE|49.76|6.64
Ginowan|JP|26.26|127.76
Inda Silasē|ET|14.1|38.28
Negara|ID|-8.36|114.62
Caçapava|BR|-23.1|-45.71
Qaşr Bin Ghashīr|LY|32.68|13.18
Renala Khurd|PK|30.88|73.6
Punta Cana|DO|18.58|-68.4
Roanoke|US|37.27|-79.94
Yanjia|CN|29.83|107
Kangding|CN|30|101.96
Suifenhe|CN|44.4|131.15
Sino-Singapore Tianjin Eco-city|CN|39.15|117.78
Alamar|CU|23.16|-82.28
Becontree|GB|51.55|0.13
Sumedang Utara|ID|-6.85|107.92
Jaffa|IL|32.05|34.75
Airoli|IN|19.15|73
Shahrak-e Pardīsān|IR|34.56|50.8
P’yŏngsŏng|KP|39.25|125.87
Tājūrā’|LY|32.88|13.35
Colonia Lindavista|MX|19.49|-99.12
Sentul|MY|3.18|101.68
Seri Manjung|MY|4.2|100.67
Bandar Mahkota Cheras|MY|3.05|101.8
Alasia|NG|6.47|3.17
Raja Jang|PK|31.22|74.25
Model Town|PK|31.48|74.33
Subotica|RS|46.1|19.67
Tekstil’shchiki|RU|55.7|37.74
Nyagatare|RW|-1.3|30.32
Sabt Alalayah|SA|19.58|41.96
Sakiet ez Zit|TN|34.8|10.76`;
