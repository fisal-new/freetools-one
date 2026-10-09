/* */
//import * as L from "https://unpkg.com/leaflet/dist/leaflet-src.esm.js";
//import * as L from 'https://cdn.jsdelivr.net/npm/leaflet@1.6.0/+esm';

let baseUrl = '/v1/geolocation/json';

let q = '';
let manualSearch = false;
let map = null;

function init() {
  const qp = new URLSearchParams(window.location.search);
  q = qp.get('q');
  if (q === '' || q === null || q === undefined) {
    getAjaxData(baseUrl, drawMap);
  } else {
    manualSearch = true;
    getAjaxData(baseUrl + '?q=' + encodeURIComponent(q), drawMap);
  }
  const form = document.querySelector('form.form');
  const input = document.getElementById('q');
  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      manualSearch = true;
      q = v;
      getAjaxData(baseUrl + '?q=' + encodeURIComponent(v), drawMap);
    });
  }
}

function drawMap(data) {
  if (q === '' || q === null || q === undefined) {
    document.getElementById('q').value = data.ip;
  } else {
    document.getElementById('q').value = q;
  }
  value1.innerText = data.ip;
  value2.innerText = data.city;
  value3.innerText = data.region_name; //+ ' ' + data.region_code;
  value4.innerText = data.country_name + ' ' + data.country_code;
  value5.innerText = data.zip_code;
  value6.innerText = data.time_zone;
  value7.innerText = data.latitude + ' , ' + data.longitude;

  if (map) {
    map.remove();
    map = null;
  }
  map = L.map('mapid').setView([data.latitude, data.longitude], 4);
  let popupText = manualSearch
    ? `<b>Result</b><br>IP : ${data.ip}`
    : `<b>You Are Here</b><br>IP : ${data.ip}`;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  L.marker([data.latitude, data.longitude])
    .addTo(map)
    .bindPopup(popupText)
    .openPopup();
}

function getAjaxData(urlData, callback) {
  const xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) { // 4 = "DONE"
      if (xhr.status === 200) { // 200 ="OK"
        document.getElementById('geoError').textContent = '';
        callback(JSON.parse(xhr.responseText));
      } else {
        let msg = 'Request failed (HTTP ' + xhr.status + ')';
        try {
          const j = JSON.parse(xhr.responseText);
          if (j.Error) msg = j.Error;
        } catch (e) { /* keep default */ }
        document.getElementById('geoError').textContent = msg;
      }
    }
  };
  xhr.open('GET', urlData);
  xhr.send();
}

export {
  init
};
