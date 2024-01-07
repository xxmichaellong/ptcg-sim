import { reset } from "../../actions/general/reset.js";
import { oppContainer, selfContainer, socket, systemState } from "../../front-end.js";
import { appendMessage } from "../chatbox/messages.js";
import { determineUsername } from "../general/determine-username.js";
import { show } from "../home-header/header-toggle.js";
import { getCardType } from "./find-type.js";

const decklistTable = document.getElementById('decklistTable');
const altDeckImportInput = document.getElementById('altDeckImportInput');
const cancelButton = document.getElementById('cancelButton');
const confirmButton = document.getElementById('confirmButton');
const decklistsButton = document.getElementById('decklistsButton');
const failedText = document.getElementById('failedText');
const importButton = document.getElementById('importButton');
const invalidText = document.getElementById('invalidText');
const loadingText = document.getElementById('loadingText');
const mainDeckImportInput = document.getElementById('mainDeckImportInput');
const p1Button = document.getElementById('p1Button');
const p2Button = document.getElementById('p2Button');
const saveButton = document.getElementById('saveButton');
const csvFile = document.getElementById('csvFile');

export const importDecklist = (user) => {
    failedText.style.display = 'none';
    invalidText.style.display = 'none';
    loadingText.style.display = 'block';
    importButton.disabled = true;

    const decklist = user === 'self' ? mainDeckImportInput.value : altDeckImportInput.value;

    const regexWithOldSet = /(\d+) (.+?)(?= \w*-\w*\d*$) (\w*-\w*\d*)/;
    const regexWithSet = /(\d+) (.+?) (\w{2,3}) (\d+[a-zA-Z]?)/;
    const regexWithPRSet = /(\d+) (.+?) (PR-\w{2,3}) (\d+)/;
    const regexWithSpecialSet = /(\d+) (.+?) ((?:\w{2,3}(?:\s+[a-zA-Z\d]+)*)(?:\s+(\w{2,3}\s*[a-zA-Z\d]+)\s*)*)$/;
    const regexWithoutSet = /(\d+) (.+?)(?=\s\d|$|(\s\d+))/;
    
    // Initialize an array to store the results
    const decklistArray = [];
    
    // Split the decklist into lines
    const lines = decklist.split('\n');
    
    // Process each line
    lines.forEach(line => {
        //ptcglive conversion for GG/TG cards (the alt art bs) (don't apply to promo sets)
        line = line.replace(/(?!PR-)(\w{2,3})-(\w{2,3}) (\d+)/g, '$1 $2$3');
        //special case for double crisis set
        line = line.replace(/xy5-5/g, 'DCR');

        let matchWithOldSet = line.match(regexWithOldSet);
        let matchWithSet = line.match(regexWithSet);
        let matchWithPRSet = line.match(regexWithPRSet);
        let matchWithSpecialSet = line.match(regexWithSpecialSet);
        let matchWithoutSet = line.match(regexWithoutSet);
    
        if (matchWithOldSet) {
            const [, quantity, name, id,] = matchWithOldSet;
            decklistArray.push([parseInt(quantity), name, id, null, null]);
            
            fetch('https://api.pokemontcg.io/v2/cards/' + id, {
                method: 'GET',
                headers: {
                    'X-Api-Key': 'cde33a60-5d8a-414e-ae04-b447090dd6ba'
                }
            })
            .then(response => response.json())
            .then(({data}) => {
                const index = decklistArray.findIndex(item => item[2] === id && item[3] === null);
                decklistArray[index] = [parseInt(quantity), name, id, data.images.large, data.supertype]

            })
            .catch((error) => {
                console.error('Error:', error);
            });
        } else if (matchWithSet) {
            const [, quantity, name, set, setNumber] = matchWithSet;
            decklistArray.push([parseInt(quantity), name, `${set} ${setNumber}`]);
        } else if (matchWithPRSet) {
            const [, quantity, name, prSet, setNumber] = matchWithPRSet;
            decklistArray.push([parseInt(quantity), name, `${prSet} ${setNumber}`]);
        } else if (matchWithSpecialSet) {
            const [, quantity, name, set] = matchWithSpecialSet;
            decklistArray.push([parseInt(quantity), name, set.trim()]);
        } else if (matchWithoutSet) {
            const [, quantity, name] = matchWithoutSet;
            decklistArray.push([parseInt(quantity), name, '']);
        };
    });
        
    if (decklistArray.length < 1){
        failedText.style.display = 'block';
        loadingText.style.display = 'none';      
        importButton.disabled = false;
        return;
    };
    const energies = {
        'Fire Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_EN.png',
        'Grass Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_G_R_EN.png',
        'Fairy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TEU/TEU_Y_R_EN.png',
        'Darkness Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_D_R_EN.png',
        'Lightning Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_L_R_EN.png',
        'Fighting Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_F_R_EN.png',
        'Psychic Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_P_R_EN.png',
        'Metal Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_M_R_EN.png',
        'Water Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_W_R_EN.png',
        'Basic Fire Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_EN.png',
        'Basic Grass Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_G_R_EN.png',
        'Basic Fairy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TEU/TEU_Y_R_EN.png',
        'Basic Darkness Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_D_R_EN.png',
        'Basic Lightning Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_L_R_EN.png',
        'Basic Fighting Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_F_R_EN.png',
        'Basic Psychic Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_P_R_EN.png',
        'Basic Metal Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_M_R_EN.png',
        'Basic Water Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_W_R_EN.png',
        'Basic {W} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_W_R_EN.png',
        'Basic {R} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_EN.png',
        'Basic {G} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_G_R_EN.png',
        'Basic {Y} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TEU/TEU_Y_R_EN.png',
        'Basic {D} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_D_R_EN.png',
        'Basic {L} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_L_R_EN.png',
        'Basic {F} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_F_R_EN.png',
        'Basic {P} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_P_R_EN.png',
        'Basic {M} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_M_R_EN.png'
    };

    const specialCases = {
        'PR-SV' : 'SVP',
        'PR-SW' : 'SSP',
        'PR-SM' : 'SMP',
        'PR-XY' : 'XYP',
        'PR-BLW' : 'BWP',
        'PR-HS' : 'HSP'
    };
      
    decklistArray.forEach((entry) => {
        if (!entry[2].match(/\w*-\w*\d*$/)){
            const [q, name, set] = entry;

            const energyUrl = energies[name];
    
            if (energyUrl) {
                entry.push(energyUrl);
                entry.push('Energy');
            } else {
                let [firstPart, secondPart] = set.split(/(?<=\S)\s/);
                if (firstPart && secondPart){
                    if (specialCases[firstPart]){
                        firstPart = specialCases[firstPart];
                    };
                    const paddedSecondPart = secondPart.replace(/^(\d+)([a-zA-Z])?$/, (_, digits, letter) => {
                        const paddedDigits = digits.length < 3 ? digits.padStart(3, '0') : digits;
                        return letter ? paddedDigits + letter : paddedDigits;
                    });
                    const url = `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/${firstPart.replace(/ /g, '/')}/${firstPart.replace(/ /g, '_')}_${paddedSecondPart}_R_EN.png`;
                    entry.push(url);
                    entry.push(getCardType(firstPart, secondPart));
                } else {
                    failedText.style.display = 'block';
                    loadingText.style.display = 'none';
                };
            };
        };
    });

    let fetchPromises = decklistArray.map(([quantity, name, id]) => {
        if (id.match(/\w*-\w*\d*$/)) {
            return fetch('https://api.pokemontcg.io/v2/cards/' + id, {
                method: 'GET',
                headers: {
                    'X-Api-Key': 'cde33a60-5d8a-414e-ae04-b447090dd6ba'
                }
            })
            .then(response => response.json())
            .then(({data}) => {
                const index = decklistArray.findIndex(item => item[2] === id && item[3] === null);
                if (index !== -1) {
                    decklistArray[index] = [parseInt(quantity), name, id, data.images.large, data.supertype];
                }
            })
            .catch((error) => {
                console.error('Error:', error);
                failedText.style.display = 'block';
                loadingText.style.display = 'none';
                importButton.disabled = false;
            });
        } else {
            return Promise.resolve();
        };
    });    

    Promise.all(fetchPromises)
    .then(() => {
        let tableBody = decklistTable.getElementsByTagName('tbody')[0];
        decklistTable.style.display = 'block';
        decklistArray.forEach(([quantity, name, , url, type]) => {
            let newRow = tableBody.insertRow();
            
            let qtyCell = newRow.insertCell(0);
            let nameCell = newRow.insertCell(1);
            let typeCell = newRow.insertCell(2);
            let urlCell = newRow.insertCell(3);
            
            qtyCell.contentEditable = "true";
            nameCell.contentEditable = "true";
            urlCell.contentEditable = "true";
            typeCell.contentEditable = "true";
            
            qtyCell.innerHTML = quantity;
            nameCell.innerHTML = name;
            urlCell.innerHTML = url;
            typeCell.innerHTML = type;
        });
        importButton.disabled = false;
        selfContainer.style.zIndex = -1;
        oppContainer.style.zIndex = -1;
        loadingText.style.display = 'none';
        decklistsButton.style.display = 'none';
        importButton.style.display = 'none';
        confirmButton.style.display = 'block';
        cancelButton.style.display = 'block';
        saveButton.style.display = 'block';
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

cancelButton.addEventListener('click', () => {
    selfContainer.style.zIndex = 0;
    oppContainer.style.zIndex = 0;
    decklistsButton.style.display = 'block';
    importButton.style.display = 'block';
    confirmButton.style.display = 'none';
    cancelButton.style.display = 'none';
    saveButton.style.display = 'none';
    let tableBody = decklistTable.getElementsByTagName('tbody')[0];
    while (tableBody.firstChild) {
        tableBody.removeChild(tableBody.firstChild);
    };
    decklistTable.style.display = 'none';
});

confirmButton.addEventListener('click', () => {
    selfContainer.style.zIndex = 0;
    oppContainer.style.zIndex = 0;
    decklistsButton.style.display = 'block';
    importButton.style.display = 'block';
    confirmButton.style.display = 'none';
    cancelButton.style.display = 'none';
    saveButton.style.display = 'none';

    const user = mainDeckImportInput.style.display !== 'none' ? 'self' : 'opp';
    let tableBody = decklistTable.getElementsByTagName('tbody')[0];
    let rows = tableBody.rows;
    let deckData = [];
    for (let i = 0; i < rows.length; i++) {
        let cells = rows[i].cells;
        
        let quantity = cells[0].innerText;
        let name = cells[1].innerText;
        let type = cells[2].innerText;
        let url = cells[3].innerText;

        let cardData = [quantity, name, type, url];
        deckData.push(cardData);
    };
    while (tableBody.firstChild) {
        tableBody.removeChild(tableBody.firstChild);
    };
    decklistTable.style.display = 'none';
    if (user === 'self'){
        systemState.selfDeckData = deckData;
    } else {
        systemState.p1OppDeckData = deckData;
    };
    if (!systemState.isTwoPlayer){
        show('p1Box', p1Button);
    } else if (user === 'self'){
        show('p2Box', p2Button);
    };
    if (!(systemState.isTwoPlayer && user === 'opp')){
        reset(user, true, false, true, false);
        appendMessage(user, determineUsername(user) + ' imported deck', 'announcement', false);
    } else {
        invalidText.style.display = 'block';
    };
    if (systemState.isTwoPlayer && user === 'self'){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : systemState.roomId,
            deckData : systemState.selfDeckData,
            user: oUser
        };
        socket.emit('deckData', data);
    };
})
       
const downloadCSV = (csv, filename) => {
    let csvFile;
    let downloadLink;

    // CSV file
    csvFile = new Blob([csv], {type: "text/csv"});
    downloadLink = document.createElement("a");
    downloadLink.download = filename;
    // Create a link to the file
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = "none";
    document.body.appendChild(downloadLink);
    downloadLink.click();
}

const exportTableToCSV = (filename) => {
    let csv = [];
    let rows = document.querySelectorAll("#decklistTable tr");
    
    for (let i = 0; i < rows.length; i++) {
        let row = [], cols = rows[i].querySelectorAll("td, th");
        
        for (let j = 0; j < cols.length; j++) 
            row.push(cols[j].innerText);
        
        csv.push(row.join(","));        
    };

    downloadCSV(csv.join("\n"), filename);
}

saveButton.addEventListener('click', () => {
    exportTableToCSV('decklist.csv');
});

csvFile.addEventListener('change', (evt) => {
    importButton.disabled = false;
    selfContainer.style.zIndex = -1;
    oppContainer.style.zIndex = -1;
    loadingText.style.display = 'none';
    decklistsButton.style.display = 'none';
    importButton.style.display = 'none';
    failedText.style.display = 'none';
    decklistTable.style.display = 'block';
    confirmButton.style.display = 'block';
    cancelButton.style.display = 'block';
    saveButton.style.display = 'block';

    let file = evt.target.files[0];
    let reader = new FileReader();
    reader.onload = (e) => {
        let contents = e.target.result;
        let lines = contents.split('\n');
        let tableBody = decklistTable.getElementsByTagName('tbody')[0];
        // Clear the table body
        while (tableBody.firstChild) {
            tableBody.removeChild(tableBody.firstChild);
        };
        // Populate the table with the CSV data, skipping the first line (i.e., the headers)
        for (let i = 1; i < lines.length; i++) {
            let cells = lines[i].split(',');
            let newRow = tableBody.insertRow();
            for (let j = 0; j < cells.length; j++) {
                let newCell = newRow.insertCell();
                newCell.innerText = cells[j];
                newCell.contentEditable = "true";
            };
        };
    };
    reader.readAsText(file);
    evt.target.value = '';
});