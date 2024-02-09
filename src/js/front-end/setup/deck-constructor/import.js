import { reset } from "../../actions/general/reset.js";
import { oppContainer, oppContainerDocument, selfContainer, selfContainerDocument, systemState } from "../../front-end.js";
import { appendMessage } from "../chatbox/append-message.js";
import { determineUsername } from "../general/determine-username.js";
import { processAction } from "../general/process-action.js";
import { show } from "../home-header/header-toggle.js";
import { getCardType } from "./find-type.js";

const decklistTable = document.getElementById('decklistTable');
const altDeckImportInput = document.getElementById('altDeckImportInput');
const cancelButton = document.getElementById('cancelButton');
const confirmButton = document.getElementById('confirmButton');
const decklistsButton = document.getElementById('decklistsButton');
const failedText = document.getElementById('failedText');
const importButton = document.getElementById('importButton');
const randomButton = document.getElementById('randomButton');
const invalidText = document.getElementById('invalidText');
const loadingText = document.getElementById('loadingText');
const mainDeckImportInput = document.getElementById('mainDeckImportInput');
const p1Button = document.getElementById('p1Button');
const p2Button = document.getElementById('p2Button');
const saveButton = document.getElementById('saveButton');
const saveCurrentButton = document.getElementById('saveCurrentButton');
const csvFile = document.getElementById('csvFile');
const changeCardBackButton = document.getElementById('changeCardBackButton');
const changeLanguageButton = document.getElementById('changeLanguageButton');

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
    // Each card will be stored as [quantity, name, set code, number, pokemontcg.io id, image url, type]
    const decklistArray = [];
    
    // Split the decklist into lines
    const lines = decklist.split('\n');
    
    // Process each line
    lines.forEach(line => {
        //ptcglive conversion for GG/TG cards (the alt art bs) (don't apply to promo sets)
        line = line.replace(/(?!PR-)(\w{2,3})-(\w{2,3}) (\d+)/g, '$1 $2$3');
        //special case for double crisis set
        line = line.replace(/xy5-5 /g, 'DCR ');

        let matchWithOldSet = line.match(regexWithOldSet);
        let matchWithSet = line.match(regexWithSet);
        let matchWithPRSet = line.match(regexWithPRSet);
        let matchWithSpecialSet = line.match(regexWithSpecialSet);
        let matchWithoutSet = line.match(regexWithoutSet);
    
        if (matchWithOldSet) {
            const [, quantity, name, id,] = matchWithOldSet;
            decklistArray.push([parseInt(quantity), name, null, null, id, null, undefined]);
            
            // the following is commented out because it's done below anyway
            /*
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
            */
        } else if (matchWithSet) {
            const [, quantity, name, set, setNumber] = matchWithSet;
            decklistArray.push([parseInt(quantity), name, set, setNumber, null, null, undefined]);
        } else if (matchWithPRSet) {
            const [, quantity, name, prSet, setNumber] = matchWithPRSet;
            decklistArray.push([parseInt(quantity), name, prSet, setNumber, null, null, undefined]);
        } else if (matchWithSpecialSet) {
            const [, quantity, name, setAll] = matchWithSpecialSet;
            const [set, setNumber] = setAll.trim().split(/(?<=\S)\s/);
            decklistArray.push([parseInt(quantity), name, set, setNumber, null, null, undefined]);
        } else if (matchWithoutSet) {
            const [, quantity, name] = matchWithoutSet;
            decklistArray.push([parseInt(quantity), name, null, null, null, null, undefined]);
        };
    });
        
    if (decklistArray.length < 1){
        failedText.style.display = 'block';
        loadingText.style.display = 'none';      
        importButton.disabled = false;
        return;
    };

    const languageText = changeLanguageButton.textContent;
    let language;
    switch (languageText) {
      case "Language: English":
        language = "EN";
        break;
      case "Language: French":
        language = "FR";
        break;
      case "Language: German":
        language = "DE";
        break;
      case "Language: Italian":
        language = "IT";
        break;
      case "Language: Portuguese":
        language = "PT";
        break;
      case "Language: Spanish":
        language = "ES";
        break;
      default:
        language = "EN";
    };

    const energies = {
        'Fire Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_${language}.png`,
        'Grass Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_G_R_${language}.png`,
        'Fairy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TEU/TEU_Y_R_${language}.png`,
        'Darkness Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_D_R_${language}.png`,
        'Lightning Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_L_R_${language}.png`,
        'Fighting Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_F_R_${language}.png`,
        'Psychic Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_P_R_${language}.png`,
        'Metal Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_M_R_${language}.png`,
        'Water Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_W_R_${language}.png`,
        'Basic Fire Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_${language}.png`,
        'Basic Grass Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_G_R_${language}.png`,
        'Basic Fairy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TEU/TEU_Y_R_${language}.png`,
        'Basic Darkness Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_D_R_${language}.png`,
        'Basic Lightning Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_L_R_${language}.png`,
        'Basic Fighting Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_F_R_${language}.png`,
        'Basic Psychic Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_P_R_${language}.png`,
        'Basic Metal Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_M_R_${language}.png`,
        'Basic Water Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_W_R_${language}.png`,
        'Basic {W} Energy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_W_R_${language}.png`,
        'Basic {R} Energy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_${language}.png`,
        'Basic {G} Energy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_G_R_${language}.png`,
        'Basic {Y} Energy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TEU/TEU_Y_R_${language}.png`,
        'Basic {D} Energy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_D_R_${language}.png`,
        'Basic {L} Energy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_L_R_${language}.png`,
        'Basic {F} Energy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_F_R_${language}.png`,
        'Basic {P} Energy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_P_R_${language}.png`,
        'Basic {M} Energy Energy': `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_M_R_${language}.png`
    };

    const specialCases = {
        'PR-SV' : 'SVP',
        'PR-SW' : 'SSP',
        'PR-SM' : 'SMP',
        'PR-XY' : 'XYP',
        'PR-BLW' : 'BWP',
        'PR-HS' : 'HSP'
    };
    
    // the following are taken from pokemontcg.io (v2)'s ptcgoCode
    const oldSetCode_to_id = {'BS': 'base1', 'JU': 'base2', 'PR': 'basep', 'FO': 'base3', 'B2': 'base4', 'TR': 'base5', 'G1': 'gym1', 'G2': 'gym2', 'N1': 'neo1', 'N2': 'neo2', 'N3': 'neo3', 'N4': 'neo4', 'LC': 'base6', 'EX': 'ecard1', 'BP': 'bp', 'AQ': 'ecard2', 'SK': 'ecard3', 'RS': 'ex1', 'SS': 'ex2', 'DR': 'ex3', 'PR-NP': 'np', 'MA': 'ex4', 'HL': 'ex5', 'RG': 'ex6', 'TRR': 'ex7', 'DX': 'ex8', 'EM': 'ex9', 'UF': 'ex10', 'DS': 'ex11', 'LM': 'ex12', 'HP': 'ex13', 'CG': 'ex14', 'DF': 'ex15', 'PK': 'ex16', 'DP': 'dp1', 'PR-DPP': 'dpp', 'MT': 'dp2', 'SW': 'dp3', 'GE': 'dp4', 'MD': 'dp5', 'LA': 'dp6', 'SF': 'dp7', 'PL': 'pl1', 'RR': 'pl2', 'SV': 'pl3', 'AR': 'pl4'};
      
    decklistArray.forEach((entry) => {
        if (!entry[4]){
            const [q, name, set, setNumber] = entry;
            let [firstPart, secondPart] = [set, setNumber]
            const energyUrl = energies[name];
            if (firstPart && secondPart){
                if (specialCases[firstPart]){
                    firstPart = specialCases[firstPart];
                };
                if(oldSetCode_to_id[firstPart]){
                    entry[4] = oldSetCode_to_id[firstPart]+'-'+secondPart;
                }
            }
            if (firstPart && secondPart && !entry[4]){
                const paddedSecondPart = secondPart.replace(/^(\d+)([a-zA-Z])?$/, (_, digits, letter) => {
                    const paddedDigits = digits.length < 3 ? digits.padStart(3, '0') : digits;
                    return letter ? paddedDigits + letter : paddedDigits;
                });
                const url = `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/${firstPart.replace(/ /g, '/')}/${firstPart.replace(/ /g, '_')}_${paddedSecondPart}_R_${language}.png`;
                entry[5] = url;
                entry[6] = getCardType(firstPart, secondPart);
            } else if (energyUrl){
                entry[5] = energyUrl;
                entry[6] = 'Energy';
            } else if(!entry[4] && (!entry[5] || !entry[6])) {
                failedText.style.display = 'block';
                loadingText.style.display = 'none';
            };
        };
    });

    let fetchPromises = decklistArray.map(([quantity, name, set, setNumber, id]) => {
        if (id) {
            return fetch('https://api.pokemontcg.io/v2/cards/' + id, {
                method: 'GET',
                headers: {
                    'X-Api-Key': 'cde33a60-5d8a-414e-ae04-b447090dd6ba'
                }
            })
            .then(response => response.json())
            .then(({data}) => {
                const index = decklistArray.findIndex(item => item[4] === id);
                if (index !== -1) {
                    decklistArray[index][5] = data.images.large;
                    decklistArray[index][6] = data.supertype;
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
        decklistArray.forEach(([quantity, name, , , , url, type]) => {
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
        randomButton.style.display = 'none';
        changeLanguageButton.style.display = 'none';
        confirmButton.style.display = 'block';
        cancelButton.style.display = 'block';
        saveButton.style.display = 'block';
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

export const loadDeckData = (user, deckData, emit = true) => {
    if (user === 'self') {
        systemState.selfDeckData = deckData;
    } else if (systemState.isTwoPlayer) {
        systemState.p2OppDeckData = deckData;
    } else {
        systemState.p1OppDeckData = deckData;
    };
    reset(user, true, true, false, false);
    appendMessage('', determineUsername(user) + ' imported deck', 'announcement', false);
    processAction(user, emit, 'loadDeckData', [deckData]);
}

cancelButton.addEventListener('click', () => {
    selfContainer.style.zIndex = 0;
    oppContainer.style.zIndex = 0;
    decklistsButton.style.display = 'block';
    importButton.style.display = 'block';
    randomButton.style.display = 'block';
    changeLanguageButton.style.display = 'inline-block';
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
    randomButton.style.display = 'block';
    saveCurrentButton.style.display = 'block';
    changeLanguageButton.style.display = 'inline-block';
    confirmButton.style.display = 'none';
    cancelButton.style.display = 'none';
    saveButton.style.display = 'none';

    let user = mainDeckImportInput.style.display !== 'none' ? 'self' : 'opp';
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

    // Create a copy of the current table and append it to currentDecklistTable
    const currentDecklistTable = user === 'self' ? document.getElementById('selfCurrentDecklistTable') : document.getElementById('oppCurrentDecklistTable');
    currentDecklistTable.innerHTML = '';
    // Clone the content (rows) of decklistTable
    rows = decklistTable.rows;
    let clonedContent = document.createDocumentFragment();

    for (let i = 0; i < rows.length; i++) {
        let clonedRow = rows[i].cloneNode(true);
        clonedContent.appendChild(clonedRow);
    };
    // Append the cloned content to currentDecklistTable
    currentDecklistTable.appendChild(clonedContent);

    while (tableBody.firstChild) {
        tableBody.removeChild(tableBody.firstChild);
    };
    decklistTable.style.display = 'none';
    if (!systemState.isTwoPlayer){
        show('p1Box', p1Button);
    } else if (user === 'self' && !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer)){
        show('p2Box', p2Button);
    };
    loadDeckData(user, deckData);
})

// ************ logic for saving decklists********************//
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

const exportTableToCSV = (filename, table) => {
    let csv = [];
    let rows = document.querySelectorAll(table);
    
    for (let i = 0; i < rows.length; i++) {
        let row = [], cols = rows[i].querySelectorAll("td, th");
        
        for (let j = 0; j < cols.length; j++) 
            row.push(cols[j].innerText);
        
        csv.push(row.join(","));        
    };

    downloadCSV(csv.join("\n"), filename);
}

saveButton.addEventListener('click', () => {
    exportTableToCSV('decklist.csv', "#decklistTable tr");
});

saveCurrentButton.addEventListener('click', () => {
    let table = mainDeckImportInput.style.display !== 'none' ? "#selfCurrentDecklistTable tr" : "#oppCurrentDecklistTable tr";
    exportTableToCSV('decklist.csv', table);
});

csvFile.addEventListener('change', (evt) => {
    importButton.disabled = false;
    selfContainer.style.zIndex = -1;
    oppContainer.style.zIndex = -1;
    loadingText.style.display = 'none';
    decklistsButton.style.display = 'none';
    importButton.style.display = 'none';
    randomButton.style.display = 'none';
    changeLanguageButton.style.display = 'none';
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

// ************ logic for changing cardbacks********************//
export const changeCardBack = (user, userInput, emit = true) => {
    const containerDocument = user === 'self' ? selfContainerDocument : oppContainerDocument;
    containerDocument.querySelectorAll('img').forEach(img => {
        if ([systemState.cardBackSrc, systemState.p1OppCardBackSrc, systemState.p2OppCardBackSrc].includes(img.src)){
            img.src = userInput;
        };
    });
    if (user === 'self'){
        systemState.cardBackSrc = userInput;
    } else if (systemState.isTwoPlayer){
        systemState.p2OppCardBackSrc = userInput;
    } else {
        systemState.p1OppCardBackSrc = userInput;
    };

    processAction(user, emit, 'changeCardBack', [userInput]);
}

changeCardBackButton.addEventListener('click', () => {
    let userInput = window.prompt("Paste your image URL or type 'default':");
    const user = mainDeckImportInput.style.display !== 'none' ? 'self' : 'opp';

    if (userInput !== null && userInput.trim() !== '' && userInput.toLowerCase() === 'default') {
        userInput = 'https://ptcgsim.online/src/cardback.png';
    };
    const img = new Image();
    img.onload = () => {
        if (user === 'self' || !systemState.isTwoPlayer){
            changeCardBack(user, userInput);
        } else {
            changeCardBack(user, userInput, false);
        };
    };
    img.onerror = () => {
        alert('Please enter a valid image URL.');
    };
    img.src = userInput;
});

// ************ logic for changing language********************//
const languageDropdown = document.getElementById("languageDropdown");
changeLanguageButton.addEventListener("click", () => {
    languageDropdown.style.display = "block";
    document.addEventListener('mousedown', hideLanguageDropdown);
});
// Add click event listeners to dropdown items
const dropdownItems = languageDropdown.querySelectorAll("li");
dropdownItems.forEach((item) => {
    item.addEventListener("click", () => {
        const selectedLanguage = item.textContent;
        changeLanguage(selectedLanguage);
        languageDropdown.style.display = 'none';
    });
});

const changeLanguage = (language) => {
    changeLanguageButton.textContent = `Language: ${language}`;
};

// Function to hide the context menu
const hideLanguageDropdown = (event) => {
    if (!languageDropdown.contains(event.target)) {
        languageDropdown.style.display = 'none';
        document.removeEventListener('mousedown', hideLanguageDropdown);
    };
};