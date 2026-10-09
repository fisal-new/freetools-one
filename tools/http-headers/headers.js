/* */

let baseUrl = '/v1/headers';

function init() {
  document.getElementById('addUrl').addEventListener('click', getHeaders);
  // deep-link: ?domain=example.com (#20)
  try {
    const qp = new URLSearchParams(window.location.search);
    const d = (qp.get("domain") || "").trim();
    if (d) {
      document.getElementById('urlName').value = d;
      getHeaders();
    }
  } catch (e) { /* ignore bad query */ }
}

function getHeaders(e) {
  let url = document.getElementById('urlName').value;
  if (url === '') {
    alert('Url cannot be empty');
    return;
  }
  if (!isValidHostname(url)) {
    alert('Not a valid url');
    return;
  }
  document.getElementById('result').innerHTML = '';
  document.getElementById('hdrLoader').style.display = 'block';
  let urlData = baseUrl + '?domain=' + url;
  getAjaxData(urlData, showData);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

function showData(dataRaw) {
  let data = JSON.parse(dataRaw);
  let res = '';
  for (let i = 0; i < data.length; i++) {
    res += `
      <table class="table">
          <thead class="thead">
            <tr>
              <th class="header">Header</th>
              <th class="value">Value</th>
            </tr>
          </thead>
          <tbody class="tbody">`;
    for (let prop in data[i]) {
      res +=
        `<tr class="tr">
        <td>${esc(prop)}</td>
        <td>${esc(data[i][prop])}</td>
        </tr>`;
    }
    res += `
      </tbody>
      </table>`;
  }
  document.getElementById('hdrLoader').style.display = 'none';
  document.getElementById('result').innerHTML = res;
}

function showError(dataError) {
  document.getElementById('hdrLoader').style.display = 'none';
  if (dataError.Error) {
    // alert(dataError.error)
    document.getElementById('result').innerText = dataError.Error;
  } else {
    alert('An error has occurred while fetching data');
  }
}

function limitExceeded() {
  alert('Rate limit exceeded, wait a few seconds');
}

function getAjaxData(urlData, callback) {
  const xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) { // 4 = "DONE"
      const ms = xhr.getResponseHeader("x-elapsed-ms");
      document.getElementById('hdrMs').textContent = ms ? "(" + ms + " ms server-side)" : "";
      if (xhr.status === 200) { // 200 ="OK"
        //callback(JSON.parse(xhr.responseText))
        callback(xhr.responseText);
      } else if (xhr.status === 429) { // 200 ="OK"
        limitExceeded();
      } else {
        // Error parsed from backend myError
        showError(JSON.parse(xhr.responseText));
      }
    }
  };
  xhr.open('GET', urlData); // add false to synchronous request
  xhr.send();
}

function isValidHostname(hostname) {
  hostname = hostname.trim();
  if (!hostname) return false;
  if (hostname.toLowerCase() === "localhost") return true;
  try {
    const u = new URL(hostname.includes("://") ? hostname : "https://" + hostname);
    return !!u.hostname && !/\s/.test(u.hostname);
  } catch (e) {
    return false;
  }
}

export {
  init
};
