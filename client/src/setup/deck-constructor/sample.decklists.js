const decklistsByYear = {
  '2023-2024 S&V': {
    Charizard: `
        Pokémon (17)
        3 Charmander MEW 4
        1 Charmander PR-SV 47
        1 Charmeleon OBF 27
        3 Charizard ex OBF 125
        2 Pidgey MEW 16
        2 Pidgeot ex OBF 164
        1 Rotom V CRZ 45
        1 Lumineon V BRS 40
        1 Mew CEL 11
        1 Manaphy BRS 41
        1 Jirachi PAR 126
        
        Trainer (36)
        4 Arven OBF 186
        3 Boss's Orders PAL 172
        3 Iono PAL 185
        1 Professor's Research SVI 189
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        4 Rare Candy SVI 191
        2 Level Ball BST 129
        2 Lost Vacuum CRZ 135
        2 Counter Catcher PAR 160
        1 Super Rod PAL 188
        1 Forest Seal Stone SIT 156
        1 Justified Gloves CRE 143
        1 Vitality Band SVI 197
        1 Lost City LOR 161
        1 Artazon PAL 171
        1 Collapsed Stadium BRS 137
        
        Energy (7)
        7 Fire Energy 2`,
    Gardevoir: `
        Pokémon (19)
        4 Ralts ASR 60
        3 Kirlia SIT 68
        1 Kirlia CRE 60
        2 Gardevoir ex SVI 86
        2 Gardevoir CRE 61
        1 Zacian V CEL 16
        1 Scream Tail PAR 86
        1 Radiant Greninja ASR 46
        1 Manaphy BRS 41
        1 Mew CEL 11
        1 Cresselia LOR 74
        1 Jirachi PAR 126
        
        Trainer (29)
        4 Iono PAL 185
        2 Avery CRE 130
        1 Professor's Research SVI 189
        1 Boss's Orders PAL 172
        4 Battle VIP Pass FST 225
        3 Level Ball BST 129
        3 Ultra Ball SVI 196
        2 Fog Crystal CRE 140
        2 Super Rod PAL 188
        2 Counter Catcher PAR 160
        2 Rare Candy SVI 191
        1 Lost Vacuum CRZ 135
        1 Artazon PAL 171
        1 Collapsed Stadium BRS 137
        
        Energy (12)
        10 Psychic Energy 5
        2 Reversal Energy PAL 192`,
    'Lost Zone Box': `
        Pokémon (11)
        4 Comfey LOR 79
        1 Radiant Greninja ASR 46
        1 Cramorant LOR 50
        1 Kyogre CEL 3
        1 Sableye LOR 70
        1 Dragonite V PR-SW 154
        1 Roaring Moon ex PAR 124
        1 Iron Hands ex PAR 70
        
        Trainer (38)
        4 Colress's Experiment LOR 155
        1 Roxanne ASR 150
        1 Boss's Orders PAL 172
        4 Switch Cart ASR 154
        4 Mirage Gate LOR 163
        4 Battle VIP Pass FST 225
        3 Escape Rope BST 125
        3 Super Rod PAL 188
        3 Nest Ball SVI 181
        2 Energy Recycler BST 124
        2 Lost Vacuum CRZ 135
        1 Switch SVI 194
        1 Hisuian Heavy Ball ASR 146
        1 Pal Pad SVI 182
        2 Forest Seal Stone SIT 156
        2 PokéStop PGO 68
        
        Energy (11)
        4 Water Energy 3
        3 Darkness Energy 7
        2 Lightning Energy 4
        2 Psychic Energy 5`,
    'Lost Zone Giratina': `
        Pokémon (14)
        4 Comfey LOR 79
        3 Giratina V LOR 130
        3 Giratina VSTAR LOR 131
        2 Sableye LOR 70
        1 Cramorant LOR 50
        1 Radiant Greninja ASR 46
        
        Trainer (33)
        4 Colress's Experiment LOR 155
        2 Roxanne ASR 150
        1 Iono PAL 185
        1 Boss's Orders PAL 172
        4 Mirage Gate LOR 163
        4 Battle VIP Pass FST 225
        3 Nest Ball SVI 181
        2 Super Rod PAL 188
        2 Counter Catcher PAR 160
        2 Switch Cart ASR 154
        2 Escape Rope BST 125
        1 Switch SVI 194
        1 Pokégear 3.0 SVI 186
        4 Path to the Peak CRE 148
        
        Energy (13)
        4 Jet Energy PAL 190
        4 Psychic Energy 5
        3 Grass Energy 1
        2 Water Energy 3`,
    'Fusion Mew': `
        Pokémon (13)
        4 Mew V CRZ 60
        2 Mew VMAX FST 114
        4 Genesect V FST 185
        1 Deoxys FST 120
        1 Eiscue BRS 44
        1 Meloetta FST 124
        
        Trainer (40)
        2 Judge SVI 176
        2 Boss's Orders PAL 172
        2 Elesa's Sparkle FST 233
        1 Iono PAL 185
        1 Professor Turo's Scenario PAR 171
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        4 Power Tablet FST 236
        4 Cram-o-matic FST 229
        3 Lost Vacuum CRZ 135
        1 Feather Ball ASR 141
        1 Hisuian Heavy Ball ASR 146
        1 Nest Ball SVI 181
        1 Escape Rope BST 125
        1 Switch SVI 194
        1 Pal Pad SVI 182
        2 Forest Seal Stone SIT 156
        1 Box of Disaster LOR 154
        1 Choice Belt PAL 176
        2 Path to the Peak CRE 148
        1 Lost City LOR 161
        
        Energy (7)
        4 Fusion Strike Energy FST 244
        3 Double Turbo Energy BRS 151`,
    Miraidon: `
        Pokémon (14)
        2 Miraidon ex SVI 81
        2 Iron Hands ex PAR 70
        2 Mew ex MEW 151
        1 Raikou V BRS 48
        1 Raichu V BRS 45
        1 Mareep EVS 54
        1 Flaaffy EVS 55
        1 Zapdos PGO 29
        1 Squawkabilly ex PAL 169
        1 Lumineon V BRS 40
        1 Spiritomb PAL 89
        
        Trainer (29)
        4 Peony CRE 150
        2 Boss's Orders PAL 172
        1 Raihan CRZ 140
        4 Electric Generator SVI 170
        4 Ultra Ball SVI 196
        2 Battle VIP Pass FST 225
        2 Escape Rope BST 125
        1 Switch SVI 194
        1 Nest Ball SVI 181
        1 Lost Vacuum CRZ 135
        1 Super Rod PAL 188
        2 Bravery Charm PAL 173
        1 Forest Seal Stone SIT 156
        2 Beach Court SVI 167
        1 Collapsed Stadium BRS 137
        
        Energy (17)
        16 Lightning Energy 4
        1 Double Turbo Energy BRS 151`,
    'Urshifu Inteleon': `
        Pokémon (18)
        3 Inteleon V FST 78
        3 Inteleon VMAX FST 79
        2 Rapid Strike Urshifu V BST 87
        2 Rapid Strike Urshifu VMAX BST 88
        2 Remoraid PAR 33
        2 Octillery BST 37
        1 Squawkabilly ex PAL 169
        1 Medicham V EVS 83
        1 Spiritomb PAL 89
        1 Radiant Alakazam SIT 59
        
        Trainer (33)
        3 Professor's Research SVI 189
        2 Iono PAL 185
        2 Korrina's Focus BST 128
        2 Melony CRE 146
        2 Klara CRE 145
        1 Professor Turo's Scenario PAR 171
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        2 Earthen Vessel PAR 163
        2 Nest Ball SVI 181
        2 Energy Retrieval SVI 171
        1 Escape Rope BST 125
        2 Forest Seal Stone SIT 156
        1 Technical Machine: Devolution PAR 177
        3 Tower of Waters BST 138
        
        Energy (9)
        5 Water Energy 3
        4 Rapid Strike Energy BST 140`,
    'Chien-Pao': `
        Pokémon (16)
        3 Chien-Pao ex PAL 61
        2 Frigibax PAL 57
        1 Frigibax PAL 58
        2 Bidoof CRZ 111
        2 Bibarel BRS 121
        2 Baxcalibur PAL 60
        1 Radiant Greninja ASR 46
        1 Manaphy BRS 41
        1 Iron Hands ex PAR 70
        1 Iron Bundle PAR 56
        
        Trainer (35)
        4 Irida ASR 147
        1 Iono PAL 185
        4 Battle VIP Pass FST 225
        4 Nest Ball SVI 181
        4 Ultra Ball SVI 196
        4 Superior Energy Retrieval PAL 189
        3 Rare Candy SVI 191
        3 Super Rod PAL 188
        2 Earthen Vessel PAR 163
        1 Hisuian Heavy Ball ASR 146
        1 Counter Catcher PAR 160
        4 PokéStop PGO 68
        
        Energy (9)
        8 Water Energy 3
        1 Lightning Energy 4`,
    'Snorlax Stall': `
        Pokémon (8)
        4 Snorlax PGO 55
        1 Rotom V CRZ 45
        1 Pidgeot V LOR 137
        1 Mimikyu PAL 97
        1 Spiritomb PAL 89
        
        Trainer (52)
        4 Arven OBF 186
        3 Penny SVI 183
        3 Iono PAL 185
        3 Miss Fortune Sisters LOR 164
        2 Boss's Orders PAL 172
        2 Erika's Invitation MEW 160
        1 Avery CRE 130
        1 Giacomo PAL 182
        1 Sidney FST 241
        1 Peonia CRE 149
        1 Cyllene ASR 138
        1 Team Yell's Cheer BRS 149
        4 Counter Catcher PAR 160
        4 Nest Ball SVI 181
        4 Pokégear 3.0 SVI 186
        2 Pal Pad SVI 182
        2 Switch Cart ASR 154
        1 Battle VIP Pass FST 225
        1 Hisuian Heavy Ball ASR 146
        1 Echoing Horn CRE 136
        1 Super Rod PAL 188
        3 Bravery Charm PAL 173
        1 Luxurious Cape PAR 166
        1 Forest Seal Stone SIT 156
        2 Temple of Sinnoh ASR 155
        2 Pokémon League Headquarters OBF 192
        `,
  },
  '2022-2023 S&S': {
    Lugia: `
        Pokémon (21)
        4 Lugia V SIT 138
        3 Lugia VSTAR SIT 139
        4 Archeops SIT 147
        2 Lumineon V BRS 40
        2 Tyranitar V BST 97
        1 Single Strike Urshifu V BST 85
        1 Single Strike Urshifu VMAX BST 86
        1 Yveltal FST 175
        1 Radiant Tsareena SIT 16
        1 Pumpkaboo EVS 76
        1 Squawkabilly ex PAL 169
        
        Trainer (26)
        3 Professor's Research SVI 189
        3 Boss's Orders PAL 172
        2 Iono PAL 185
        1 Serena SIT 164
        1 Professor Burnet PR-SW 167
        4 Ultra Ball SVI 196
        4 Capturing Aroma SIT 153
        3 Urn of Vitality BST 139
        2 Nest Ball SVI 181
        2 Mesagoza SVI 178
        1 Collapsed Stadium BRS 137
        
        Energy (13)
        4 Single Strike Energy BST 141
        3 Double Turbo Energy BRS 151
        2 Gift Energy LOR 171
        2 V Guard Energy SIT 169
        2 Jet Energy PAL 190`,
    'Turbo Lost Zone Box': `
        Pokémon (13)
        4 Comfey LOR 79
        2 Sableye LOR 70
        1 Cramorant LOR 50
        1 Radiant Greninja ASR 46
        1 Dragonite V PR-SW 154
        1 Raikou V BRS 48
        1 Drapion V LOR 118
        1 Lumineon V BRS 40
        1 Manaphy BRS 41
        
        Trainer (39)
        4 Colress's Experiment LOR 155
        1 Boss's Orders PAL 172
        1 Klara CRE 145
        1 Roxanne ASR 150
        4 Mirage Gate LOR 163
        4 Battle VIP Pass FST 225
        4 Switch Cart ASR 154
        4 Escape Rope BST 125
        3 Nest Ball SVI 181
        3 Super Rod PAL 188
        3 Lost Vacuum CRZ 135
        1 Hisuian Heavy Ball ASR 146
        1 Ultra Ball SVI 196
        1 Pal Pad SVI 182
        2 Forest Seal Stone SIT 156
        2 PokéStop PGO 68
        
        Energy (8)
        4 Water Energy 3
        2 Psychic Energy 5
        2 Lightning Energy 4`,
    'Lost Zone Box Kyogre': `
        Pokémon (12)
        4 Comfey LOR 79
        2 Sableye LOR 70
        1 Cramorant LOR 50
        1 Radiant Greninja ASR 46
        1 Kyogre CEL 3
        1 Manaphy BRS 41
        1 Dragonite V PR-SW 154
        1 Pidgeot V LOR 137
        
        Trainer (37)
        4 Colress's Experiment LOR 155
        2 Roxanne ASR 150
        1 Klara CRE 145
        4 Mirage Gate LOR 163
        4 Battle VIP Pass FST 225
        4 Switch Cart ASR 154
        3 Escape Rope BST 125
        3 Nest Ball SVI 181
        2 Energy Recycler BST 124
        2 Super Rod PAL 188
        2 Lost Vacuum CRZ 135
        1 Hisuian Heavy Ball ASR 146
        1 Echoing Horn CRE 136
        2 Forest Seal Stone SIT 156
        2 Artazon PAL 171
        
        Energy (11)
        5 Water Energy 3
        4 Psychic Energy 5
        2 Lightning Energy 4`,
    'Fusion Mew': `
        Pokémon (13)
        4 Mew V CRZ 60
        3 Mew VMAX FST 114
        4 Genesect V FST 185
        1 Meloetta FST 124
        1 Oricorio FST 42
        
        Trainer (40)
        2 Elesa's Sparkle FST 233
        2 Boss's Orders PAL 172
        1 Iono PAL 185
        1 Judge SVI 176
        4 Power Tablet FST 236
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        4 Cram-o-matic FST 229
        2 Nest Ball SVI 181
        2 Lost Vacuum CRZ 135
        2 Switch Cart ASR 154
        1 Escape Rope BST 125
        1 Pal Pad SVI 182
        3 Forest Seal Stone SIT 156
        2 Choice Belt PAL 176
        1 Box of Disaster LOR 154
        2 Lost City LOR 161
        1 Path to the Peak CRE 148
        1 Crystal Cave EVS 144
        
        Energy (7)
        4 Fusion Strike Energy FST 244
        3 Double Turbo Energy BRS 151`,
    'Arceus Umbreon': `
        Pokémon (18)
        4 Arceus V BRS 122
        3 Arceus VSTAR BRS 123
        2 Umbreon V EVS 94
        2 Umbreon VMAX EVS 95
        1 Flying Pikachu V CEL 6
        1 Flying Pikachu VMAX CEL 7
        1 Spiritomb PAL 89
        1 Slaking V PGO 58
        1 Hawlucha SVI 118
        1 Radiant Alakazam SIT 59
        1 Lumineon V BRS 40
        
        Trainer (28)
        4 Iono PAL 185
        3 Boss's Orders PAL 172
        2 Professor's Research SVI 189
        1 Judge SVI 176
        1 Raihan CRZ 140
        1 Adventurer's Discovery FST 224
        4 Ultra Ball SVI 196
        4 Nest Ball SVI 181
        1 Switch SVI 194
        1 Escape Rope BST 125
        2 Choice Belt PAL 176
        3 Lost City LOR 161
        1 Path to the Peak CRE 148
        
        Energy (14)
        4 Darkness Energy 7
        4 Double Turbo Energy BRS 151
        3 Lightning Energy 4
        3 V Guard Energy SIT 169`,
    Gardevoir: `
        Pokémon (18)
        3 Ralts ASR 60
        1 Ralts SIT 67
        3 Kirlia SIT 68
        1 Kirlia CRE 60
        2 Gardevoir ex SVI 86
        2 Gardevoir CRE 61
        1 Zacian V CEL 16
        1 Cresselia LOR 74
        1 Mew CEL 11
        1 Radiant Greninja ASR 46
        1 Manaphy BRS 41
        1 Lumineon V BRS 40
        
        Trainer (30)
        3 Iono PAL 185
        2 Professor's Research SVI 189
        2 Boss's Orders PAL 172
        4 Battle VIP Pass FST 225
        4 Level Ball BST 129
        3 Ultra Ball SVI 196
        3 Rare Candy SVI 191
        2 Fog Crystal CRE 140
        2 Super Rod PAL 188
        1 Lost Vacuum CRZ 135
        1 Pal Pad SVI 182
        1 Forest Seal Stone SIT 156
        1 Artazon PAL 171
        1 Collapsed Stadium BRS 137
        
        Energy (12)
        10 Psychic Energy 5
        2 Reversal Energy PAL 192`,
    Palkia: `
        Pokémon (15)
        4 Origin Forme Palkia V ASR 39
        3 Origin Forme Palkia VSTAR ASR 40
        2 Chien-Pao ex PAL 61
        1 Radiant Greninja ASR 46
        1 Bidoof CRZ 111
        1 Bibarel BRS 121
        1 Lumineon V BRS 40
        1 Articuno SIT 36
        1 Spiritomb PAL 89
        
        Trainer (35)
        4 Irida ASR 147
        3 Iono PAL 185
        2 Melony CRE 146
        2 Boss's Orders PAL 172
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        4 Cross Switcher FST 230
        3 Switch SVI 194
        2 Escape Rope BST 125
        2 Nest Ball SVI 181
        1 Hisuian Heavy Ball ASR 146
        1 Energy Search SVI 172
        3 Lost City LOR 161
        
        Energy (10)
        10 Water Energy 3`,
  },
  '2021-2022 S&S': {
    'Arceus Flying Pikachu': `
        Pokémon (23)
        4 Arceus V BRS 122
        3 Arceus VSTAR BRS 123
        3 Flying Pikachu V CEL 6
        2 Flying Pikachu VMAX CEL 7
        2 Hisuian Decidueye V ASR 83
        2 Hisuian Decidueye VSTAR ASR 84
        2 Bidoof BRS 120
        2 Bibarel BRS 121
        1 Crobat V SHF 44
        1 Lumineon V BRS 40
        1 Pumpkaboo EVS 76
        
        Trainer (25)
        4 Marnie CPA 56
        4 Boss's Orders BRS 132
        2 Professor's Research BRS 147
        1 Raihan EVS 152
        4 Quick Ball FST 237
        4 Ultra Ball BRS 150
        1 Evolution Incense SSH 163
        1 Switch SSH 183
        4 Path to the Peak CRE 148
        
        Energy (12)
        4 Double Turbo Energy BRS 151
        4 Lightning Energy 4
        3 Fighting Energy 6
        1 Capture Energy RCL 171`,
    'Palkia Inteleon': `
        Pokémon (19)
        3 Origin Forme Palkia V ASR 39
        3 Origin Forme Palkia VSTAR ASR 40
        4 Sobble CRE 41
        3 Drizzile SSH 56
        1 Inteleon SSH 58
        1 Inteleon CRE 43
        1 Radiant Greninja ASR 46
        1 Crabominable V FST 76
        1 Manaphy BRS 41
        1 Galarian Zigzagoon SSH 117
        
        Trainer (34)
        4 Irida ASR 147
        2 Melony CRE 146
        1 Boss's Orders BRS 132
        1 Roxanne ASR 150
        4 Cross Switcher FST 230
        4 Battle VIP Pass FST 225
        3 Capacious Bucket RCL 156
        3 Scoop Up Net RCL 165
        3 Evolution Incense SSH 163
        2 Quick Ball FST 237
        2 Level Ball BST 129
        1 Hisuian Heavy Ball ASR 146
        1 Echoing Horn CRE 136
        1 Choice Belt BRS 135
        1 Tool Jammer BST 136
        1 Training Court RCL 169
        
        Energy (7)
        7 Water Energy 3`,
    'Fusion Mew': `
        Pokémon (14)
        4 Mew V FST 113
        3 Mew VMAX FST 114
        4 Genesect V FST 185
        2 Meloetta FST 124
        1 Pumpkaboo EVS 76
        
        Trainer (39)
        3 Elesa's Sparkle FST 233
        3 Boss's Orders BRS 132
        4 Power Tablet FST 236
        4 Battle VIP Pass FST 225
        4 Quick Ball FST 237
        4 Ultra Ball BRS 150
        4 Cram-o-matic FST 229
        4 Rotom Phone CPA 64
        2 Switch SSH 183
        2 Escape Rope BST 125
        1 Echoing Horn CRE 136
        2 Choice Belt BRS 135
        2 Rose Tower DAA 169
        
        Energy (7)
        4 Fusion Strike Energy FST 244
        3 Double Turbo Energy BRS 151`,
    'Ice Rider Calyrex Palkia': `
        Pokémon (19)
        3 Ice Rider Calyrex V CRE 45
        2 Ice Rider Calyrex VMAX CRE 46
        2 Origin Forme Palkia V ASR 39
        2 Origin Forme Palkia VSTAR ASR 40
        2 Bidoof BRS 120
        2 Bibarel BRS 121
        1 Radiant Greninja ASR 46
        1 Empoleon V BST 40
        1 Crobat V SHF 44
        1 Pyukumuku FST 77
        1 Mew CEL 11
        1 Pumpkaboo EVS 76
        
        Trainer (33)
        4 Irida ASR 147
        3 Melony CRE 146
        4 Cross Switcher FST 230
        4 Quick Ball FST 237
        4 Ultra Ball BRS 150
        4 Trekking Shoes ASR 156
        2 Capacious Bucket RCL 156
        1 Battle VIP Pass FST 225
        1 Tool Scrapper RCL 168
        1 Canceling Cologne ASR 136
        1 Switch SSH 183
        2 Choice Belt BRS 135
        1 Air Balloon SSH 156
        1 Training Court RCL 169
        
        Energy (8)
        8 Water Energy 3`,
    'Charizard Inteleon': `
        Pokémon (14)
        4 Sobble CRE 41
        3 Drizzile SSH 56
        2 Inteleon SSH 58
        1 Radiant Charizard PGO 11
        1 Mew CEL 11
        1 Snorlax VIV 131
        1 Manaphy BRS 41
        1 Galarian Zigzagoon SSH 117
        
        Trainer (41)
        4 Irida ASR 147
        2 Raihan EVS 152
        2 Klara CRE 145
        1 Boss's Orders BRS 132
        4 Cross Switcher FST 230
        4 Scoop Up Net RCL 165
        4 Level Ball BST 129
        3 Quick Ball FST 237
        3 Evolution Incense SSH 163
        3 Energy Search SSH 161
        1 Hisuian Heavy Ball ASR 146
        1 Ordinary Rod SSH 171
        1 Rescue Carrier EVS 154
        1 Rare Candy PGO 69
        1 Tool Scrapper RCL 168
        2 Choice Belt BRS 135
        1 Air Balloon SSH 156
        3 Magma Basin BRS 144
        
        Energy (5)
        2 Fire Energy 2
        2 Water Energy 3
        1 Twin Energy RCL 174`,
    Regis: `
        Pokémon (12)
        2 Regieleki EVS 60
        2 Regidrago ASR 118
        2 Regigigas ASR 130
        2 Regice ASR 37
        2 Regirock ASR 75
        2 Registeel ASR 108
        
        Trainer (37)
        4 Professor's Research BRS 147
        3 Marnie CPA 56
        2 Cynthia's Ambition BRS 138
        2 Boss's Orders BRS 132
        4 Ordinary Rod SSH 171
        4 Scoop Up Net RCL 165
        4 Quick Ball FST 237
        3 Ultra Ball BRS 150
        2 Energy Loto ASR 140
        1 Hisuian Heavy Ball ASR 146
        4 Choice Belt BRS 135
        4 PokéStop PGO 68
        
        Energy (11)
        4 Aurora Energy SSH 186
        3 Speed Lightning Energy RCL 173
        2 Capture Energy RCL 171
        2 Twin Energy RCL 174`,
    'Arceus Inteleon': `
        Pokémon (17)
        4 Arceus V BRS 122
        3 Arceus VSTAR BRS 123
        4 Sobble CRE 41
        3 Drizzile SSH 56
        2 Inteleon SSH 58
        1 Oranguru SSH 148
        
        Trainer (32)
        4 Marnie CPA 56
        2 Cheren's Care BRS 134
        1 Boss's Orders BRS 132
        1 Melony CRE 146
        1 Roxanne ASR 150
        4 Quick Ball FST 237
        4 Ultra Ball BRS 150
        4 Level Ball BST 129
        2 Evolution Incense SSH 163
        2 Scoop Up Net RCL 165
        2 Pal Pad SSH 172
        2 Big Charm SSH 158
        2 Path to the Peak CRE 148
        1 Dyna Tree Hill CRE 135
        
        Energy (11)
        6 Water Energy 3
        4 Double Turbo Energy BRS 151
        1 Capture Energy RCL 171`,
  },
  '2020-2021 S&S': {
    'Urshifu Inteleon': `
        Pokémon (23)
        4 Rapid Strike Urshifu V BST 87
        3 Rapid Strike Urshifu VMAX BST 88
        4 Sobble CRE 41
        4 Drizzile SSH 56
        3 Inteleon CRE 43
        1 Inteleon SSH 58
        1 Passimian CRE 88
        1 Mew UNB 76
        1 Dedenne-GX UNB 57
        1 Jirachi-GX UNM 79
        
        Trainer (29)
        4 Professor's Research SHF 60
        3 Marnie CPA 56
        2 Boss's Orders SHF 58
        4 Quick Ball SSH 179
        4 Level Ball BST 129
        2 Evolution Incense SSH 163
        2 Pokémon Communication TEU 152
        1 Switch SSH 183
        1 Escape Rope BST 125
        1 Reset Stamp UNM 206
        1 Tool Scrapper RCL 168
        2 Karate Belt UNM 201
        1 Air Balloon SSH 156
        1 Tower of Waters BST 138
        
        Energy (8)
        4 Rapid Strike Energy BST 140
        4 Fighting Energy 6`,
    Spiritomb: `
        Pokémon (14)
        4 Spiritomb UNB 112
        3 Jirachi TEU 99
        1 Jynx UNM 76
        1 Hoopa UNM 140
        1 Mewtwo UNB 75
        1 Mew UNB 76
        1 Marshadow UNB 81
        1 Oricorio-GX CEC 95
        1 Dedenne-GX UNB 57
        
        Trainer (39)
        4 Professor's Research SHF 60
        3 Bird Keeper DAA 159
        2 Boss's Orders SHF 58
        4 Quick Ball SSH 179
        4 Level Ball BST 129
        4 Switch SSH 183
        4 Escape Rope BST 125
        4 Scoop Up Net RCL 165
        2 Ordinary Rod SSH 171
        4 Cape of Toughness DAA 160
        4 Spikemuth DAA 170
        
        Energy (7)
        4 Hiding Darkness Energy DAA 175
        3 Darkness Energy 7`,
    'ADP Moltres': `
        Pokémon (14)
        4 Galarian Moltres V CRE 97
        3 Dedenne-GX UNB 57
        2 Arceus & Dialga & Palkia-GX CEC 156
        1 Cobalion-GX TEU 106
        1 Galarian Zapdos V CRE 80
        1 Crobat V SHF 44
        1 Eldegoss V CPA 5
        1 Marshadow UNB 81
        
        Trainer (33)
        4 Boss's Orders SHF 58
        4 Professor's Research SHF 60
        3 Marnie CPA 56
        4 Quick Ball SSH 179
        4 Cherish Ball UNM 191
        3 Switch SSH 183
        2 Reset Stamp UNM 206
        1 Energy Switch SSH 162
        1 Great Catcher CEC 192
        3 Air Balloon SSH 156
        4 Viridian Forest TEU 156
        
        Energy (13)
        7 Darkness Energy 7
        4 Aurora Energy SSH 186
        1 Metal Energy 8
        1 Water Energy 3`,
    'Shadow Rider Calyrex': `
        Pokémon (16)
        4 Shadow Rider Calyrex V CRE 74
        4 Shadow Rider Calyrex VMAX CRE 75
        2 Dedenne-GX UNB 57
        2 Marshadow UNB 81
        1 Alcremie V CPA 22
        1 Alcremie VMAX CPA 23
        1 Gengar & Mimikyu-GX TEU 53
        1 Cresselia CRE 64
        
        Trainer (31)
        4 Professor's Research SHF 60
        3 Marnie CPA 56
        3 Boss's Orders SHF 58
        4 Fog Crystal CRE 140
        4 Quick Ball SSH 179
        3 Evolution Incense SSH 163
        2 Switch SSH 183
        2 Ordinary Rod SSH 171
        1 Reset Stamp UNM 206
        3 Air Balloon SSH 156
        2 Path to the Peak CRE 148
        
        Energy (13)
        13 Psychic Energy 5`,
    'Weavile Dark Box': `
        Pokémon (20)
        3 Sneasel CEC 43
        2 Weavile-GX UNM 132
        2 Malamar V RCL 121
        2 Malamar VMAX RCL 122
        2 Galarian Moltres V CRE 97
        2 Dedenne-GX UNB 57
        1 Mewtwo & Mew-GX UNM 71
        1 Umbreon & Darkrai-GX UNM 125
        1 Mega Sableye & Tyranitar-GX UNM 126
        1 Guzzlord CEC 136
        1 Eldegoss V CPA 5
        1 Mew UNB 76
        1 Marshadow UNB 81
        
        Trainer (31)
        3 Professor's Research SHF 60
        3 Marnie CPA 56
        2 Boss's Orders SHF 58
        2 Red & Blue CEC 202
        1 Cynthia & Caitlin CEC 189
        1 Mallow & Lana CEC 198
        1 Cheryl BST 123
        1 Phoebe BST 130
        4 Quick Ball SSH 179
        3 Pokémon Communication TEU 152
        3 Tag Call CEC 206
        1 Ordinary Rod SSH 171
        3 Air Balloon SSH 156
        2 Chaotic Swell CEC 187
        1 Viridian Forest TEU 156
        
        Energy (9)
        8 Darkness Energy 7
        1 Capture Energy RCL 171`,
  },
  '2019-2020 S&S': {
    'Zacian Lucario & Melmetal': `
        Pokémon (12)
        4 Zacian V SSH 138
        2 Lucario & Melmetal-GX UNB 120
        2 Zamazenta V SSH 139
        2 Bronzor TEU 100
        2 Bronzong TEU 101
        
        Trainer (35)
        4 Professor's Research SSH 178
        3 Marnie SSH 169
        2 Boss's Orders RCL 154
        2 Mallow & Lana CEC 198
        1 Cynthia & Caitlin CEC 189
        4 Quick Ball SSH 179
        4 Pokémon Communication TEU 152
        4 Metal Saucer SSH 170
        4 Switch SSH 183
        3 Tag Call CEC 206
        4 Metal Goggles TEU 148
        
        Energy (13)
        13 Metal Energy 8`,
    'Zacian ADP': `
        Pokémon (13)
        4 Zacian V SSH 138
        2 Arceus & Dialga & Palkia-GX CEC 156
        2 Zamazenta V SSH 139
        2 Dedenne-GX UNB 57
        1 Crobat V DAA 104
        1 Eldegoss V RCL 19
        1 Oranguru SSH 148
        
        Trainer (36)
        4 Professor's Research SSH 178
        3 Boss's Orders RCL 154
        2 Guzma & Hala CEC 193
        1 Cynthia & Caitlin CEC 189
        1 Mallow & Lana CEC 198
        1 Marnie SSH 169
        1 Red's Challenge UNB 184
        4 Quick Ball SSH 179
        4 Metal Saucer SSH 170
        4 Switch SSH 183
        4 Tag Call CEC 206
        1 Great Catcher CEC 192
        2 Air Balloon SSH 156
        2 Metal Goggles TEU 148
        1 Giant Bomb UNM 196
        1 Chaotic Swell CEC 187
        
        Energy (11)
        8 Metal Energy 8
        2 Aurora Energy SSH 186
        1 Capture Energy RCL 171`,
    'Inteleon Frosmoth': `
        Pokémon (20)
        4 Inteleon V RCL 49
        3 Inteleon VMAX RCL 50
        3 Snom SSH 63
        2 Frosmoth SSH 64
        2 Dedenne-GX UNB 57
        2 Crobat V DAA 104
        2 Galarian Zigzagoon SSH 117
        1 Lapras V SSH 49
        1 Suicune DAA 37
        
        Trainer (31)
        4 Professor's Research SSH 178
        4 Marnie SSH 169
        3 Boss's Orders RCL 154
        4 Quick Ball SSH 179
        4 Pokémon Communication TEU 152
        3 Scoop Up Net RCL 165
        2 Evolution Incense SSH 163
        2 Capacious Bucket RCL 156
        3 Air Balloon SSH 156
        2 Training Court RCL 169
        
        Energy (9)
        9 Water Energy 3`,
    Centiskorch: `
        Pokémon (14)
        4 Centiskorch V DAA 33
        3 Centiskorch VMAX DAA 34
        2 Volcanion UNB 25
        1 Victini V SSH 25
        1 Heatran-GX UNM 25
        1 Dedenne-GX UNB 57
        1 Crobat V DAA 104
        1 Eldegoss V RCL 19
        
        Trainer (33)
        4 Welder UNB 189
        2 Boss's Orders RCL 154
        2 Cynthia & Caitlin CEC 189
        1 Mallow & Lana CEC 198
        4 Pokégear 3.0 SSH 174
        4 Quick Ball SSH 179
        4 Pokémon Communication TEU 152
        4 Switch SSH 183
        2 Fire Crystal UNB 173
        2 Reset Stamp UNM 206
        2 Big Charm SSH 158
        2 Giant Hearth UNM 197
        
        Energy (13)
        9 Fire Energy 2
        4 Heat Fire Energy DAA 174`,
    Eternatus: `
        Pokémon (18)
        4 Eternatus V DAA 116
        4 Eternatus VMAX DAA 117
        4 Crobat V DAA 104
        4 Galarian Zigzagoon SSH 117
        1 Hoopa DAA 111
        1 Hoopa UNM 140
        
        Trainer (32)
        4 Marnie SSH 169
        4 Boss's Orders RCL 154
        3 Professor's Research SSH 178
        4 Quick Ball SSH 179
        4 Great Ball SSH 164
        3 Scoop Up Net RCL 165
        3 Turbo Patch DAA 172
        2 Pokémon Communication TEU 152
        2 Air Balloon SSH 156
        2 Viridian Forest TEU 156
        1 Black Market ♢ TEU 134
        
        Energy (10)
        8 Darkness Energy 7
        2 Capture Energy RCL 171`,
  },
  '2018-2019 S&M': {
    'Mewtwo & Mew': `
        Pokémon (16)
        4 Mewtwo & Mew-GX UNM 71
        3 Dedenne-GX UNB 57
        1 Solgaleo-GX PR-SM 104
        1 Reshiram & Charizard-GX UNB 20
        1 Magcargo-GX LOT 44
        1 Latios-GX UNM 78
        1 Espeon & Deoxys-GX UNM 72
        1 Naganadel-GX UNM 160
        1 Jirachi-GX UNM 79
        1 Cobalion-GX TEU 106
        1 Marshadow UNB 81
        
        Trainer (33)
        4 Welder UNB 189
        2 Bill's Analysis TEU 133
        4 Pokégear 3.0 UNB 182
        4 Acro Bike CES 123
        4 Cherish Ball UNM 191
        4 Custom Catcher LOT 171
        3 Mysterious Treasure FLI 113
        2 Switch CES 147
        1 Electromagnetic Radar UNB 169
        1 Fire Crystal UNB 173
        3 Giant Hearth UNM 197
        1 Viridian Forest TEU 156
        
        Energy (11)
        8 Fire Energy 2
        3 Psychic Energy 5`,
    'Blacephalon Naganadel': `
        Pokémon (16)
        3 Blacephalon-GX LOT 52
        3 Poipole FLI 55
        1 Poipole LOT 107
        3 Naganadel LOT 108
        2 Naganadel-GX UNM 160
        2 Heatran-GX UNM 25
        1 Dedenne-GX UNB 57
        1 Mew UNB 76
        
        Trainer (28)
        4 Welder UNB 189
        4 Cynthia UPR 119
        1 Lillie UPR 125
        1 Hapu UNM 200
        4 Custom Catcher LOT 171
        4 Mysterious Treasure FLI 113
        3 Beast Ring FLI 102
        3 Cherish Ball UNM 191
        1 Reset Stamp UNM 206
        2 Ultra Space FLI 115
        1 Heat Factory ♢ LOT 178
        
        Energy (16)
        14 Fire Energy 2
        1 Psychic Energy 5
        1 Beast Energy ♢ FLI 117`,
    "Green's Reshiram & Charizard": `
        Pokémon (7)
        4 Volcanion UNB 25
        3 Reshiram & Charizard-GX UNB 20
        
        Trainer (42)
        4 Welder UNB 189
        4 Green's Exploration UNB 175
        1 Lusamine CIN 96
        4 Pokégear 3.0 UNB 182
        4 Custom Catcher LOT 171
        4 Mixed Herbs LOT 184
        4 Great Potion UNM 198
        4 Acro Bike CES 123
        3 Fire Crystal UNB 173
        2 Cherish Ball UNM 191
        1 Reset Stamp UNM 206
        1 Fiery Flint DRM 60
        1 Energy Spinner UNB 170
        1 Giant Hearth UNM 197
        1 Power Plant UNB 183
        1 Shrine of Punishment CES 143
        1 Lysandre Labs FLI 111
        1 Heat Factory ♢ LOT 178
        
        Energy (11)
        11 Fire Energy 2`,
    'Reshiram & Charizard Fire Box': `
        Pokémon (16)
        4 Jirachi TEU 99
        3 Dedenne-GX UNB 57
        2 Reshiram & Charizard-GX UNB 20
        1 Heatran-GX UNM 25
        1 Victini ♢ DRM 7
        1 Turtonator DRM 50
        2 Vulpix TEU 15
        2 Ninetales TEU 16
        
        Trainer (26)
        4 Welder UNB 189
        4 Cherish Ball UNM 191
        3 Pokémon Communication TEU 152
        3 Acro Bike CES 123
        3 Super Scoop Up CES 146
        2 Switch CES 147
        1 Pal Pad UPR 132
        2 Escape Board UPR 122
        3 Giant Hearth UNM 197
        1 Heat Factory ♢ LOT 178
        
        Energy (18)
        18 Fire Energy 2`,
    'Pikachu & Zekrom': `
        Pokémon (13)
        3 Jirachi TEU 99
        2 Pikachu & Zekrom-GX TEU 33
        2 Raichu & Alolan Raichu-GX UNM 54
        2 Dedenne-GX UNB 57
        1 Zeraora-GX LOT 86
        1 Sigilyph-GX LOT 98
        1 Zapdos TEU 40
        1 Tapu Koko ♢ TEU 51
        
        Trainer (36)
        4 Lillie UPR 125
        3 Volkner UPR 135
        1 Cyrus ♢ UPR 120
        4 Electropower LOT 172
        4 Custom Catcher LOT 171
        4 Switch CES 147
        3 Electromagnetic Radar UNB 169
        2 Pokémon Communication TEU 152
        2 Reset Stamp UNM 206
        2 Energy Switch CES 129
        1 Tag Switch UNM 209
        1 Cherish Ball UNM 191
        1 Stadium Nav UNM 208
        1 Escape Board UPR 122
        2 Lysandre Labs FLI 111
        1 Thunder Mountain ♢ LOT 191
        
        Energy (11)
        11 Lightning Energy 4`,
    'Pidgeotto Control': `
        Pokémon (18)
        4 Oranguru UPR 114
        4 Pidgey TEU 121
        4 Pidgeotto TEU 123
        2 Girafarig LOT 94
        2 Articuno-GX CES 31
        1 Ditto ♢ LOT 154
        1 Mew UNB 76
        
        Trainer (38)
        4 Professor Elm's Lecture LOT 188
        2 Cynthia UPR 119
        2 Tate & Liza CES 148
        2 Mars UPR 128
        2 Lt. Surge's Strategy UNB 178
        1 Brock's Grit TEU 135
        4 Pokégear 3.0 UNB 182
        4 Acro Bike CES 123
        4 Crushing Hammer SUM 115
        3 Custom Catcher LOT 171
        2 Reset Stamp UNM 206
        2 Chip-Chip Ice Axe UNB 165
        2 Pokémon Communication TEU 152
        2 Pal Pad UPR 132
        2 Power Plant UNB 183
        
        Energy (4)
        3 Water Energy 3
        1 Recycle Energy UNM 212`,
    'Gardevoir & Sylveon': `
        Pokémon (6)
        4 Gardevoir & Sylveon-GX UNB 130
        1 Xerneas-GX FLI 90
        1 Mimikyu-GX LOT 149
        
        Trainer (45)
        4 Green's Exploration UNB 175
        3 Judge FLI 108
        2 Erika's Hospitality TEU 140
        2 Cynthia UPR 119
        2 Bill's Analysis TEU 133
        4 Pokégear 3.0 UNB 182
        4 Switch CES 147
        3 Cherish Ball UNM 191
        3 Great Potion UNM 198
        2 Custom Catcher LOT 171
        2 Tag Switch UNM 209
        2 Energy Spinner UNB 170
        1 Reset Stamp UNM 206
        1 Adventure Bag LOT 167
        2 Fairy Charm Lightning UNB 172
        2 Fairy Charm UB TEU 142
        1 Fairy Charm Psychic LOT 175
        4 Power Plant UNB 183
        1 Wondrous Labyrinth ♢ TEU 158
        
        Energy (9)
        9 Fairy Energy 9`,
  },
  '2017-2018 S&M': {
    'Zoroark Garbodor': `
        Pokémon (18)
        4 Zorua SLG 52
        4 Zoroark-GX SLG 53
        3 Trubbish BKP 56
        2 Garbodor GRI 51
        1 Garbodor BKP 57
        3 Tapu Lele-GX GRI 60
        1 Kartana-GX CIN 70
        
        Trainer (35)
        4 N FCO 105
        3 Brigette BKT 134
        2 Guzma BUS 115
        1 Professor Sycamore BKP 107
        1 Cynthia UPR 119
        4 Puzzle of Time BKP 109
        4 Mysterious Treasure FLI 113
        3 Evosoda GEN 62
        3 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        1 Enhanced Hammer GRI 124
        1 Town Map BKT 150
        3 Float Stone BKT 137
        2 Choice Band GRI 121
        2 Parallel City BKT 145
        
        Energy (7)
        4 Double Colorless Energy SLG 69
        3 Unit Energy LPM UPR 138`,
    'Psychic Malamar': `
        Pokémon (18)
        4 Inkay FLI 50
        4 Malamar FLI 51
        2 Marshadow-GX BUS 80
        1 Dawn Wings Necrozma-GX UPR 63
        1 Necrozma-GX BUS 63
        1 Mewtwo-GX SLG 39
        1 Tapu Lele-GX GRI 60
        1 Lunala ♢ UPR 62
        1 Mimikyu GRI 58
        1 Giratina PR-XY 184
        1 Oranguru SUM 113
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        4 Cynthia UPR 119
        3 Guzma BUS 115
        1 Lillie UPR 125
        4 Mysterious Treasure FLI 113
        4 Ultra Ball SLG 68
        3 Acro Bike CES 123
        2 Field Blower GRI 125
        2 Max Elixir BKP 102
        1 Rescue Stretcher GRI 130
        4 Float Stone BKT 137
        
        Energy (10)
        10 Psychic Energy 5`,
    'Zygarde Lycanroc': `
        Pokémon (13)
        3 Zygarde-GX FLI 73
        2 Rockruff FLI 75
        2 Lycanroc-GX GRI 74
        1 Buzzwole FLI 77
        1 Buzzwole-GX CIN 57
        1 Diancie ♢ FLI 74
        1 Regirock-EX FCO 43
        1 Tapu Lele-GX GRI 60
        1 Oranguru SUM 113
        
        Trainer (31)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        3 Guzma BUS 115
        2 Cynthia UPR 119
        4 Ultra Ball SLG 68
        3 Max Elixir BKP 102
        1 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        3 Choice Band GRI 121
        3 Float Stone BKT 137
        2 Brooklet Hill GRI 120
        2 Scorched Earth FCO 110
        
        Energy (16)
        10 Fighting Energy 6
        4 Double Colorless Energy SLG 69
        2 Strong Energy FCO 115`,
    Rayquaza: `
        Pokémon (9)
        4 Rayquaza-GX CES 109
        2 Marshadow SLG 45
        1 Tapu Lele-GX GRI 60
        1 Xurkitree-GX PR-SM 68
        1 Oranguru SUM 113
        
        Trainer (37)
        4 Professor Sycamore BKP 107
        4 Guzma BUS 115
        1 Lillie UPR 125
        4 Puzzle of Time BKP 109
        4 Mysterious Treasure FLI 113
        4 Max Elixir BKP 102
        3 Acro Bike CES 123
        2 Ultra Ball SLG 68
        2 Rescue Stretcher GRI 130
        2 Field Blower GRI 125
        1 Super Rod BKT 149
        1 Escape Rope BUS 114
        3 Choice Band GRI 121
        2 Float Stone BKT 137
        
        Energy (14)
        7 Grass Energy 1
        7 Lightning Energy 4`,
    'Buzzwole Lycanroc': `
        Pokémon (14)
        3 Buzzwole FLI 77
        2 Buzzwole-GX CIN 57
        2 Rockruff FLI 75
        2 Lycanroc-GX GRI 74
        1 Diancie ♢ FLI 74
        2 Remoraid BKT 32
        1 Octillery BKT 33
        1 Tapu Lele-GX GRI 60
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        4 Guzma BUS 115
        2 N FCO 105
        2 Cynthia UPR 119
        4 Ultra Ball SLG 68
        4 Max Elixir BKP 102
        3 Beast Ring FLI 102
        1 Super Rod BKT 149
        3 Choice Band GRI 121
        2 Float Stone BKT 137
        3 Brooklet Hill GRI 120
        
        Energy (14)
        9 Fighting Energy 6
        4 Strong Energy FCO 115
        1 Beast Energy ♢ FLI 117`,
    Greninja: `
        Pokémon (17)
        4 Froakie FLI 22
        3 Frogadier BKP 39
        1 Frogadier FLI 23
        4 Greninja BKP 40
        3 Greninja BREAK BKP 41
        1 Staryu BKP 25
        1 Starmie EVO 31
        
        Trainer (33)
        4 Professor Sycamore BKP 107
        4 Cynthia UPR 119
        4 N FCO 105
        4 Ultra Ball SLG 68
        4 Evosoda GEN 62
        4 Enhanced Hammer GRI 124
        3 Max Potion GRI 128
        2 Super Rod BKT 149
        1 Rescue Stretcher GRI 130
        3 Brooklet Hill GRI 120
        
        Energy (10)
        6 Water Energy 3
        4 Splash Energy BKP 113`,
    'Zoroark Gallade': `
        Pokémon (19)
        4 Zorua SLG 52
        4 Zoroark-GX SLG 53
        4 Tapu Lele-GX GRI 60
        2 Ralts BKT 100
        2 Gallade BKT 84
        1 Oranguru UPR 114
        1 Mew-EX DRX 46
        1 Sylveon-EX GEN RC21
        
        Trainer (37)
        3 N FCO 105
        2 Professor Sycamore BKP 107
        2 Brigette BKT 134
        2 Guzma BUS 115
        1 Cynthia UPR 119
        1 Mallow GRI 127
        1 Professor Kukui SUM 128
        1 Acerola BUS 112
        1 Team Flare Grunt GEN 73
        1 Team Skull Grunt SUM 133
        1 Gladion CIN 95
        4 Puzzle of Time BKP 109
        4 Ultra Ball SLG 68
        2 Rare Candy CES 142
        2 Field Blower GRI 125
        2 Crushing Hammer SUM 115
        1 Enhanced Hammer GRI 124
        1 Max Potion GRI 128
        1 Rescue Stretcher GRI 130
        1 Counter Catcher CIN 91
        1 Pal Pad UPR 132
        1 Choice Band GRI 121
        1 Float Stone BKT 137
        
        Energy (4)
        4 Double Colorless Energy SLG 69`,
    'Banette Garbodor': `
        Pokémon (16)
        4 Trubbish BKP 56
        2 Garbodor BKP 57
        2 Garbodor GRI 51
        2 Shuppet CES 63
        2 Banette-GX CES 66
        2 Tapu Lele-GX GRI 60
        1 Drampa-GX GRI 115
        1 Buzzwole FLI 77
        
        Trainer (33)
        4 Professor Sycamore BKP 107
        4 N FCO 105
        3 Cynthia UPR 119
        3 Guzma BUS 115
        1 Brigette BKT 134
        3 Ultra Ball SLG 68
        2 Mysterious Treasure FLI 113
        2 Field Blower GRI 125
        2 Rescue Stretcher GRI 130
        4 Float Stone BKT 137
        3 Choice Band GRI 121
        2 Parallel City BKT 145
        
        Energy (11)
        4 Rainbow Energy CES 151
        4 Psychic Energy 5
        3 Double Colorless Energy SLG 69`,
  },
  '2016-2017 S&M': {
    Gardevoir: `
        Pokémon (19)
        4 Ralts BUS 91
        3 Kirlia BUS 92
        3 Gardevoir-GX BUS 93
        1 Gallade BKT 84
        2 Remoraid BKT 31
        1 Octillery BKT 33
        3 Tapu Lele-GX GRI 60
        1 Diancie BUS 94
        1 Alolan Vulpix GRI 21
        
        Trainer (29)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Guzma BUS 115
        1 Brigette BKT 134
        1 Hex Maniac AOR 75
        1 Acerola BUS 112
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        3 Rare Candy SUM 129
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        1 Super Rod BKT 149
        2 Choice Band GRI 121
        
        Energy (12)
        7 Fairy Energy 9
        4 Double Colorless Energy SUM 136
        1 Wonder Energy PRC 144`,
    'Golisopod Garbodor': `
        Pokémon (18)
        4 Wimpod BUS 16
        3 Golisopod-GX BUS 17
        4 Trubbish BKP 56
        2 Garbodor BKP 57
        2 Garbodor GRI 51
        2 Tapu Lele-GX GRI 60
        1 Tapu Koko PR-SM 30
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Guzma BUS 115
        2 Acerola BUS 112
        1 Brigette BKT 134
        1 Teammates PRC 141
        1 Hex Maniac AOR 75
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Rescue Stretcher GRI 130
        1 Field Blower GRI 125
        1 Heavy Ball BKT 140
        4 Float Stone BKT 137
        2 Choice Band GRI 121
        
        Energy (10)
        4 Rainbow Energy SUM 137
        3 Grass Energy 1
        3 Double Colorless Energy SUM 136`,
    'Espeon Garbodor': `
        Pokémon (18)
        4 Eevee SUM 101
        3 Espeon-GX SUM 61
        1 Flareon AOR 13
        4 Trubbish BKP 56
        3 Garbodor GRI 51
        1 Garbodor BKP 57
        2 Tapu Lele-GX GRI 60
        
        Trainer (30)
        3 Professor Sycamore BKP 107
        3 N FCO 105
        2 Guzma BUS 115
        1 Brigette BKT 134
        1 Hex Maniac AOR 75
        1 Teammates PRC 141
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        4 Float Stone BKT 137
        3 Choice Band GRI 121
        1 Parallel City BKT 145
        
        Energy (12)
        8 Psychic Energy 5
        4 Double Colorless Energy SUM 136`,
    'Garbodor Necrozma': `
        Pokémon (15)
        4 Trubbish BKP 56
        3 Garbodor GRI 51
        1 Garbodor BKP 57
        3 Tapu Lele-GX GRI 60
        1 Necrozma-GX BUS 63
        1 Tapu Koko PR-SM 30
        1 Espeon-EX BKP 52
        1 Mewtwo EVO 51
        
        Trainer (34)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Guzma BUS 115
        1 Brigette BKT 134
        1 Acerola BUS 112
        1 Teammates PRC 141
        1 Ninja Boy STS 103
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Field Blower GRI 125
        2 Rescue Stretcher GRI 130
        2 Enhanced Hammer GRI 124
        4 Float Stone BKT 137
        3 Choice Band GRI 121
        
        Energy (11)
        7 Psychic Energy 5
        4 Double Colorless Energy SUM 136`,
    'Ho-Oh Salazzle': `
        Pokémon (16)
        3 Ho-Oh-GX BUS 21
        2 Salandit GRI 15
        2 Salazzle-GX BUS 25
        2 Volcanion-EX STS 26
        1 Turtonator-GX GRI 18
        1 Volcanion STS 25
        3 Tapu Lele-GX GRI 60
        1 Shaymin-EX ROS 77
        1 Sudowoodo GRI 66
        
        Trainer (30)
        4 Professor Sycamore BKP 107
        3 Kiawe BUS 116
        3 Guzma BUS 115
        2 N FCO 105
        3 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Switch SUM 132
        2 Max Elixir BKP 102
        2 Super Rod BKT 149
        4 Choice Band GRI 121
        1 Float Stone BKT 137
        
        Energy (14)
        14 Fire Energy 2`,
    Volcanion: `
        Pokémon (12)
        3 Volcanion STS 25
        3 Volcanion-EX STS 26
        2 Turtonator-GX GRI 18
        2 Tapu Lele-GX GRI 60
        1 Staryu BKP 25
        1 Starmie EVO 31
        
        Trainer (34)
        4 Professor Sycamore BKP 107
        4 N FCO 105
        3 Guzma BUS 115
        1 Acerola BUS 112
        1 Hex Maniac AOR 75
        3 VS Seeker PHF 109
        3 Ultra Ball SUM 135
        4 Max Elixir BKP 102
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        3 Fighting Fury Belt BKP 99
        2 Float Stone BKT 137
        3 Brooklet Hill GRI 120
        
        Energy (14)
        14 Fire Energy 2`,
    'Mega Rayquaza': `
        Pokémon (18)
        4 Rayquaza-EX ROS 75
        3 M Rayquaza-EX ROS 76
        4 Shaymin-EX ROS 77
        2 Hoopa-EX AOR 36
        2 Tapu Lele-GX GRI 60
        1 Tapu Koko-GX GRI 47
        1 Tapu Koko PR-SM 30
        1 Sudowoodo GRI 66
        
        Trainer (33)
        3 Professor Sycamore BKP 107
        2 Guzma BUS 115
        2 Hex Maniac AOR 75
        1 N FCO 105
        1 Skyla BKT 148
        1 Pokémon Fan Club FCO 107
        3 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        3 Mega Turbo ROS 86
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        2 Rayquaza Spirit Link ROS 87
        2 Float Stone BKT 137
        2 Choice Band GRI 121
        4 Sky Field ROS 89
        
        Energy (9)
        5 Lightning Energy 4
        4 Double Colorless Energy SUM 136`,
    Greninja: `
        Pokémon (18)
        4 Froakie BKP 38
        4 Frogadier BKP 39
        4 Greninja BKP 40
        3 Greninja BREAK BKP 41
        1 Remoraid BKT 32
        1 Octillery BKT 33
        1 Tapu Lele-GX GRI 60
        
        Trainer (33)
        4 Professor Sycamore BKP 107
        4 N FCO 105
        1 Guzma BUS 115
        1 Fisherman BKT 136
        4 VS Seeker PHF 109
        4 Dive Ball PRC 125
        4 Ultra Ball SUM 135
        3 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        1 Super Rod BKT 149
        1 Enhanced Hammer GRI 124
        3 Choice Band GRI 121
        2 Brooklet Hill GRI 120
        
        Energy (9)
        6 Water Energy 3
        3 Splash Energy BKP 113`,
    'Drampa Garbodor': `
        Pokémon (15)
        3 Drampa-GX GRI 115
        4 Trubbish BKP 56
        3 Garbodor GRI 51
        1 Garbodor BKP 57
        4 Tapu Lele-GX GRI 60
        
        Trainer (33)
        4 N FCO 105
        3 Professor Sycamore BKP 107
        2 Guzma BUS 115
        1 Brigette BKT 134
        1 Teammates PRC 141
        1 Acerola BUS 112
        1 Plumeria BUS 120
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        1 Super Rod BKT 149
        4 Float Stone BKT 137
        4 Choice Band GRI 121
        
        Energy (12)
        4 Psychic Energy 5
        4 Rainbow Energy SUM 137
        4 Double Colorless Energy SUM 136`,
  },
  '2015-2016 X&Y': {
    'Mega Audino': `
        Pokémon (13)
        4 Audino-EX FCO 84
        3 M Audino-EX FCO 85
        2 Shaymin-EX ROS 77
        1 Hoopa-EX AOR 36
        1 Magearna-EX STS 75
        1 Cobalion STS 74
        1 Absol ROS 40
        
        Trainer (37)
        4 Professor Sycamore BKP 107
        2 N FCO 105
        2 Lysandre AOR 78
        2 AZ PHF 91
        1 Hex Maniac AOR 75
        1 Xerosic PHF 110
        1 Pokémon Center Lady GEN 68
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Trainers' Mail ROS 92
        1 Mega Turbo ROS 86
        1 Escape Rope PRC 127
        1 Super Rod BKT 149
        1 Startling Megaphone FLF 97
        4 Audino Spirit Link FCO 92
        2 Float Stone BKT 137
        2 Parallel City BKT 145
        
        Energy (10)
        6 Metal Energy 8
        4 Double Colorless Energy FCO 114`,
    Greninja: `
        Pokémon (18)
        4 Talonflame STS 96
        3 Froakie BKP 38
        4 Frogadier BKP 39
        3 Greninja BKP 40
        1 Greninja XY 41
        3 Greninja BREAK BKP 41
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        4 N FCO 105
        1 Ace Trainer AOR 69
        1 Fisherman BKT 136
        1 Pokémon Ranger STS 104
        4 VS Seeker PHF 109
        4 Dive Ball PRC 125
        2 Level Ball AOR 76
        2 Super Rod BKT 149
        1 Battle Compressor PHF 92
        1 Startling Megaphone FLF 97
        4 Bursting Balloon BKP 97
        3 Rough Seas PRC 137
        
        Energy (10)
        8 Water Energy 3
        2 Splash Energy BKP 113`,
    'Vileplume Toolbox': `
        Pokémon (21)
        3 Oddish AOR 1
        3 Gloom AOR 2
        3 Vileplume AOR 3
        3 Shaymin-EX ROS 77
        2 Jolteon-EX GEN 28
        2 Glaceon-EX FCO 20
        2 Aegislash-EX PHF 65
        1 Yveltal-EX XY 79
        1 Magearna-EX STS 75
        1 Trevenant-EX PRC 19
        
        Trainer (30)
        4 AZ PHF 91
        4 N FCO 105
        3 Professor Sycamore BKP 107
        2 Lysandre AOR 78
        2 Ninja Boy STS 103
        4 Ultra Ball FCO 113
        4 Trainers' Mail ROS 92
        2 Level Ball AOR 76
        4 Forest of Giant Plants AOR 74
        1 Parallel City BKT 145
        
        Energy (9)
        4 Rainbow Energy BKT 152
        4 Double Colorless Energy FCO 114
        1 Lightning Energy 4`,
    Vespiquen: `
        Pokémon (22)
        4 Combee AOR 9
        4 Vespiquen AOR 10
        4 Unown AOR 30
        3 Yveltal STS 65
        2 Remoraid BKT 32
        2 Octillery BKT 33
        1 Shaymin-EX ROS 77
        1 Malamar-EX PHF 58
        1 Druddigon FLF 70
        
        Trainer (29)
        3 Professor Sycamore BKP 107
        2 N FCO 105
        2 Lysandre AOR 78
        1 Brigette BKT 134
        1 Teammates PRC 141
        1 Hex Maniac AOR 75
        1 AZ PHF 91
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Battle Compressor PHF 92
        1 Revitalizer GEN 70
        1 Special Charge STS 105
        2 Muscle Band XY 121
        2 Float Stone BKT 137
        
        Energy (9)
        5 Darkness Energy 7
        4 Double Colorless Energy FCO 114`,
    'Night March': `
        Pokémon (17)
        4 Joltik PHF 26
        4 Pumpkaboo PHF 44
        4 Lampent PHF 42
        3 Shaymin-EX ROS 77
        2 Mew FCO 29
        
        Trainer (39)
        3 Professor Sycamore BKP 107
        2 Lysandre AOR 78
        2 Hex Maniac AOR 75
        1 N FCO 105
        1 Teammates PRC 141
        1 Pokémon Ranger STS 104
        1 AZ PHF 91
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Battle Compressor PHF 92
        4 Puzzle of Time BKP 109
        3 Trainers' Mail ROS 92
        1 Special Charge STS 105
        1 Startling Megaphone FLF 97
        1 Target Whistle PHF 106
        1 Escape Rope PRC 127
        2 Fighting Fury Belt BKP 99
        3 Dimension Valley PHF 93
        
        Energy (4)
        4 Double Colorless Energy FCO 114`,
    'Bronzong Box': `
        Pokémon (18)
        4 Bronzor PHF 60
        4 Bronzong PHF 61
        1 Bronzong BREAK FCO 62
        2 Genesect-EX FCO 64
        2 Aegislash-EX PHF 65
        2 Cobalion STS 74
        1 Magearna-EX STS 75
        2 Shaymin-EX ROS 77
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Lysandre AOR 78
        2 AZ PHF 91
        1 Xerosic PHF 110
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Max Elixir BKP 102
        1 Battle Compressor PHF 92
        3 Fighting Fury Belt BKP 99
        3 Float Stone BKT 137
        1 Sky Field ROS 89
        
        Energy (10)
        10 Metal Energy 8`,
    Waterbox: `
        Pokémon (12)
        3 Seismitoad-EX FFI 20
        3 Shaymin-EX ROS 77
        2 Manaphy-EX BKP 32
        1 Hoopa-EX AOR 36
        1 Shaymin-EX PR-XY 148
        1 Glaceon-EX FCO 20
        1 Articuno ROS 17
        
        Trainer (36)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Delinquent BKP 98
        1 Lysandre AOR 78
        1 AZ PHF 91
        1 Xerosic PHF 110
        1 Team Flare Grunt GEN 73
        1 Hex Maniac AOR 75
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Max Elixir BKP 102
        3 Energy Switch GEN 61
        3 Fighting Fury Belt BKP 99
        3 Rough Seas PRC 137
        1 Parallel City BKT 145
        
        Energy (12)
        12 Water Energy 3`,
  },
  '2014-2015 X&Y': {
    "Archie's Blastoise": `
        Pokémon (14)
        2 Blastoise PLB 16
        3 Keldeo-EX LTR 45
        2 Jirachi-EX PLB 60
        2 Shaymin-EX ROS 77
        2 Exeggcute PLF 4
        1 Articuno ROS 17
        1 Mewtwo-EX LTR 54
        1 Wailord-EX PRC 38
        
        Trainer (35)
        2 Archie's Ace in the Hole PRC 124
        2 Professor Juniper PLB 84
        1 Lysandre AOR 78
        1 N DEX 96
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        4 Battle Compressor PHF 92
        4 Superior Energy Retrieval PLF 103
        4 Trainers' Mail ROS 92
        4 Acro Bike PRC 122
        1 Computer Search BCR 137
        1 Float Stone PLF 99
        1 Muscle Band XY 121
        2 Rough Seas PRC 137
        
        Energy (11)
        11 Water Energy 3`,
    'Seismitoad Crobat': `
        Pokémon (18)
        4 Zubat PLS 53
        4 Golbat PHF 32
        3 Crobat PHF 33
        3 Seismitoad-EX FFI 20
        2 Mewtwo-EX LTR 54
        2 Shaymin-EX ROS 77
        
        Trainer (35)
        4 Professor Juniper PLB 84
        3 N DEX 96
        2 Xerosic PHF 110
        1 Lysandre AOR 78
        1 Colress PLS 118
        1 AZ PHF 91
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        4 Hypnotoxic Laser PLS 123
        4 Super Scoop Up FFI 100
        1 Computer Search BCR 137
        3 Muscle Band XY 121
        3 Virbank City Gym PLS 126
        
        Energy (7)
        4 Double Colorless Energy PHF 111
        3 Water Energy 3`,
    'Night March': `
        Pokémon (19)
        4 Joltik PHF 26
        4 Pumpkaboo PHF 44
        4 Lampent PHF 42
        4 Shaymin-EX ROS 77
        3 Mew-EX DRX 46
        
        Trainer (34)
        2 Professor Juniper PLB 84
        2 N DEX 96
        2 Lysandre AOR 78
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        4 Battle Compressor PHF 92
        4 Trainers' Mail ROS 92
        3 Acro Bike PRC 122
        1 Computer Search BCR 137
        1 Float Stone PLF 99
        1 Muscle Band XY 121
        1 Silver Bangle PLB 88
        1 Hard Charm XY 119
        4 Dimension Valley PHF 93
        
        Energy (7)
        4 Double Colorless Energy PHF 111
        3 Lightning Energy 4`,
    'Trevenant Gengar': `
        Pokémon (14)
        4 Phantump XY 54
        4 Trevenant XY 55
        3 Gengar-EX PHF 34
        2 Shaymin-EX ROS 77
        1 Jirachi-EX PLB 60
        
        Trainer (36)
        4 Professor Juniper PLB 84
        4 N DEX 96
        3 Wally ROS 94
        2 Lysandre AOR 78
        1 Colress PLS 118
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        3 Trainers' Mail ROS 92
        1 Computer Search BCR 137
        3 Float Stone PLF 99
        3 Muscle Band XY 121
        2 Silent Lab PRC 140
        2 Virbank City Gym PLS 126
        
        Energy (10)
        4 Mystery Energy PHF 112
        4 Double Colorless Energy PHF 111
        2 Psychic Energy 5`,
    Donphan: `
        Pokémon (14)
        4 Phanpy PLS 71
        4 Donphan PLS 72
        4 Hawlucha FFI 63
        1 Bunnelby PRC 121
        1 Mr. Mime PLF 47
        
        Trainer (36)
        4 Korrina FFI 95
        4 Professor Juniper PLB 84
        4 N DEX 96
        2 Lysandre AOR 78
        1 Colress PLS 118
        4 VS Seeker PHF 109
        4 Robo Substitute PHF 102
        1 Ultra Ball ROS 93
        1 Repeat Ball PRC 136
        1 Revive ROS 88
        1 Computer Search BCR 137
        2 Focus Sash FFI 91
        2 Muscle Band XY 121
        1 Silver Bangle PLB 88
        3 Fighting Stadium FFI 90
        1 Silent Lab PRC 140
        
        Energy (10)
        4 Strong Energy FFI 104
        4 Fighting Energy 6
        2 Double Colorless Energy PHF 111`,
    'Aromatisse Box': `
        Pokémon (17)
        2 Spritzee FLF 67
        1 Spritzee XY 92
        2 Aromatisse XY 93
        3 Seismitoad-EX FFI 20
        1 Mewtwo-EX LTR 54
        1 Cobalion-EX PLS 93
        1 Charizard-EX FLF 12
        1 Malamar-EX PHF 58
        1 Keldeo-EX LTR 45
        1 Manectric-EX PHF 23
        1 M Manectric-EX PHF 24
        1 Trevenant-EX PRC 19
        1 Jirachi-EX PLB 60
        
        Trainer (31)
        4 Professor Juniper PLB 84
        4 N DEX 96
        2 Lysandre AOR 78
        2 Colress PLS 118
        1 AZ PHF 91
        1 Pokémon Fan Club FLF 94
        1 Xerosic PHF 110
        3 VS Seeker PHF 109
        3 Max Potion EPO 94
        2 Ultra Ball ROS 93
        1 Sacred Ash FLF 96
        1 Computer Search BCR 137
        2 Muscle Band XY 121
        4 Fairy Garden XY 117
        
        Energy (12)
        5 Fairy Energy 9
        4 Rainbow Energy XY 131
        3 Double Colorless Energy PHF 111`,
    'Primal Groudon': `
        Pokémon (11)
        3 Groudon-EX PRC 85
        3 Primal Groudon-EX PRC 86
        3 Wobbuffet PHF 36
        1 Landorus-EX BCR 89
        1 Bunnelby PRC 121
        
        Trainer (38)
        4 Professor Juniper PLB 84
        4 Korrina FFI 95
        2 N DEX 96
        2 Lysandre AOR 78
        2 Pokémon Center Lady FLF 93
        1 Colress PLS 118
        1 Teammates PRC 141
        4 VS Seeker PHF 109
        4 Robo Substitute PHF 102
        1 Switch ROS 91
        1 Escape Rope PRC 127
        1 Professor's Letter XY 123
        1 Mega Turbo ROS 86
        1 Ultra Ball ROS 93
        1 Computer Search BCR 137
        2 Hard Charm XY 119
        1 Focus Sash FFI 91
        1 Float Stone PLF 99
        3 Silent Lab PRC 140
        1 Fighting Stadium FFI 90
        
        Energy (11)
        7 Fighting Energy 6
        4 Strong Energy FFI 104`,
    'Mega Manectric': `
        Pokémon (11)
        4 Manectric-EX PHF 23
        3 M Manectric-EX PHF 24
        2 Genesect-EX PLB 11
        1 Shaymin-EX ROS 77
        1 Deoxys-EX PLF 53
        
        Trainer (38)
        4 Professor Sycamore PHF 101
        3 N DEX 96
        1 Lysandre AOR 78
        1 Skyla BCR 134
        1 Shadow Triad PLF 102
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        3 Trainers' Mail ROS 92
        3 Acro Bike PRC 122
        2 Battle Compressor PHF 92
        2 Max Potion EPO 94
        1 Escape Rope PRC 127
        1 Switch ROS 91
        3 Manectric Spirit Link PHF 100
        2 Muscle Band XY 121
        1 G Booster PLB 92
        2 Rough Seas PRC 137
        
        Energy (11)
        5 Lightning Energy 4
        4 Grass Energy 1
        2 Plasma Energy PLB 91`,
    'Raichu Crobat': `
        Pokémon (25)
        4 Pikachu XY 42
        4 Raichu XY 43
        4 Zubat PLS 53
        3 Golbat PHF 32
        2 Crobat PHF 33
        2 Hawlucha FFI 63
        1 Bunnelby PRC 121
        4 Shaymin-EX ROS 77
        1 Jirachi-EX PLB 60
        
        Trainer (27)
        3 Colress PLS 118
        2 Professor Juniper PLB 84
        2 N DEX 96
        2 Lysandre AOR 78
        1 AZ PHF 91
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        1 Startling Megaphone FLF 97
        1 Sacred Ash FLF 96
        1 Computer Search BCR 137
        2 Silver Bangle PLB 88
        4 Sky Field ROS 89
        
        Energy (8)
        4 Double Colorless Energy PHF 111
        4 Fighting Energy 6`,
  },
  '2013-2014 X&Y': {
    'Virizion Genesect': `
        Pokémon (10)
        4 Virizion-EX PLB 9
        4 Genesect-EX PLB 11
        1 Jirachi-EX PLB 60
        1 Mr. Mime PLF 47
        
        Trainer (37)
        4 Professor Sycamore XY 122
        4 N DEX 96
        4 Skyla BCR 134
        2 Shadow Triad PLF 102
        1 Colress PLS 118
        4 Ultra Ball FLF 99
        3 Energy Switch FFI 89
        2 Enhanced Hammer DEX 94
        2 Tool Scrapper DRX 116
        1 Professor's Letter XY 123
        1 Super Rod DRV 20
        1 Colress Machine PLS 119
        1 Town Map BCR 136
        3 Muscle Band XY 121
        1 G Booster PLB 92
        3 Skyarrow Bridge NXD 91
        
        Energy (13)
        9 Grass Energy 1
        4 Plasma Energy PLB 91`,
    'Aromatisse Kangaskhan': `
        Pokémon (15)
        3 Spritzee XY 92
        2 Aromatisse XY 93
        2 Kangaskhan-EX FLF 78
        2 M Kangaskhan-EX FLF 79
        2 Mewtwo-EX LTR 54
        1 Xerneas-EX XY 97
        1 Keldeo-EX LTR 45
        1 Xerneas XY 96
        1 Suicune PLB 20
        
        Trainer (34)
        4 N DEX 96
        3 Professor Sycamore XY 122
        3 Colress PLS 118
        2 Lysandre FLF 90
        1 Shauna XY 127
        1 Bianca LTR 109
        3 Max Potion EPO 94
        2 Ultra Ball FLF 99
        2 Level Ball NXD 89
        2 Tool Scrapper DRX 116
        1 Startling Megaphone FLF 97
        1 Heavy Ball NXD 88
        1 Super Rod DRV 20
        1 Dowsing Machine PLS 128
        3 Muscle Band XY 121
        4 Fairy Garden XY 117
        
        Energy (11)
        7 Fairy Energy 9
        2 Double Colorless Energy XY 130
        1 Rainbow Energy XY 131
        1 Water Energy 3`,
    'Yveltal Garbodor': `
        Pokémon (10)
        3 Yveltal-EX XY 79
        1 Darkrai-EX LTR 88
        1 Sableye DEX 62
        2 Trubbish PLS 65
        2 Garbodor LTR 68
        1 Sawk PLB 52
        
        Trainer (39)
        4 Professor Juniper PLB 84
        4 N DEX 96
        2 Lysandre FLF 90
        1 Colress PLS 118
        4 Ultra Ball FLF 99
        4 Dark Patch DEX 93
        4 Hypnotoxic Laser PLS 123
        4 Bicycle PLS 117
        2 Switch KSS 38
        1 Random Receiver DEX 99
        1 Professor's Letter XY 123
        1 Dowsing Machine PLS 128
        3 Muscle Band XY 121
        2 Float Stone PLF 99
        2 Virbank City Gym PLS 126
        
        Energy (11)
        7 Darkness Energy 7
        4 Double Colorless Energy XY 130`,
    'Plasma Lugia': `
        Pokémon (9)
        4 Deoxys-EX PLF 53
        2 Thundurus-EX PLF 38
        2 Lugia-EX LTR 102
        1 Kyurem PLF 31
        
        Trainer (39)
        4 Professor Juniper PLB 84
        2 Colress PLS 118
        2 Lysandre FLF 90
        1 Shauna XY 127
        4 Bicycle PLS 117
        4 Colress Machine PLS 119
        3 Roller Skates XY 125
        3 Switch KSS 38
        3 Ultra Ball FLF 99
        2 Team Plasma Ball PLF 105
        2 Escape Rope PLS 120
        2 Tool Scrapper DRX 116
        1 Pal Pad FLF 92
        1 Town Map BCR 136
        1 Computer Search BCR 137
        4 Muscle Band XY 121
        
        Energy (12)
        4 Plasma Energy PLB 91
        4 Double Colorless Energy XY 130
        4 Prism Energy NXD 93`,
    'Blastoise Keldeo': `
        Pokémon (14)
        3 Squirtle BCR 29
        1 Wartortle BCR 30
        3 Blastoise PLB 16
        2 Keldeo-EX LTR 45
        2 Black Kyurem-EX PLS 95
        1 Black Kyurem BCR 100
        1 Voltorb PLF 32
        1 Electrode PLF 33
        
        Trainer (35)
        4 Skyla BCR 134
        3 Professor Juniper PLB 84
        3 N DEX 96
        1 Colress PLS 118
        1 Lysandre FLF 90
        4 Superior Energy Retrieval PLF 103
        3 Rare Candy PLB 85
        3 Ultra Ball FLF 99
        2 Pokémon Catcher KSS 36
        2 Startling Megaphone FLF 97
        1 Level Ball NXD 89
        1 Heavy Ball NXD 88
        1 Max Potion EPO 94
        1 Professor's Letter XY 123
        1 Super Rod DRV 20
        1 Dowsing Machine PLS 128
        3 Tropical Beach PR-BLW 50
        
        Energy (11)
        9 Water Energy 3
        2 Lightning Energy 4`,
    'Landorus Raichu': `
        Pokémon (18)
        3 Landorus-EX BCR 89
        1 Mewtwo-EX LTR 54
        3 Pikachu XY 42
        3 Raichu XY 43
        1 Voltorb XY 44
        1 Electrode PLF 33
        1 Jirachi-EX PLB 60
        2 Drifloon PLB 34
        2 Drifblim PLB 35
        1 Palkia-EX PLB 66
        
        Trainer (31)
        4 Professor Juniper PLB 84
        4 N DEX 96
        3 Colress PLS 118
        2 Lysandre FLF 90
        4 Hypnotoxic Laser PLS 123
        3 Ultra Ball FLF 99
        3 Switch KSS 38
        1 Level Ball NXD 89
        1 Computer Search BCR 137
        4 Muscle Band XY 121
        2 Virbank City Gym PLS 126
        
        Energy (11)
        7 Fighting Energy 6
        4 Double Colorless Energy XY 130`,
  },
  '2012-2013 B&W': {
    'Darkrai Sableye': `
        Pokémon (10)
        4 Darkrai-EX DEX 63
        3 Sableye DEX 62
        2 Keldeo-EX BCR 49
        1 Mr. Mime PLF 47
        
        Trainer (40)
        4 Professor Juniper DEX 98
        4 N DEX 96
        4 Dark Patch DEX 93
        4 Pokémon Catcher EPO 95
        4 Hypnotoxic Laser PLS 123
        3 Random Receiver DEX 99
        3 Ultra Ball DEX 102
        3 Energy Switch BLW 94
        2 Bicycle PLS 117
        2 Enhanced Hammer DEX 94
        1 Energy Search BCR 128
        1 Tool Scrapper DRX 116
        1 Computer Search BCR 137
        2 Dark Claw DEX 92
        2 Virbank City Gym PLS 126
        
        Energy (10)
        10 Darkness Energy 7`,
    'Plasma Kyurem': `
        Pokémon (11)
        3 Deoxys-EX PLF 53
        2 Thundurus-EX PLF 38
        2 Kyurem PLF 31
        2 Keldeo-EX BCR 49
        1 Lugia-EX PLS 108
        1 Absol PLF 67
        
        Trainer (36)
        4 Professor Juniper DEX 98
        4 N DEX 96
        4 Colress PLS 118
        3 Skyla BCR 134
        4 Pokémon Catcher EPO 95
        3 Hypnotoxic Laser PLS 123
        3 Colress Machine PLS 119
        2 Team Plasma Ball PLF 105
        2 Max Potion EPO 94
        1 Ultra Ball DEX 102
        1 Enhanced Hammer DEX 94
        1 Computer Search BCR 137
        3 Float Stone PLF 99
        1 Virbank City Gym PLS 126
        
        Energy (13)
        4 Plasma Energy PLF 106
        4 Prism Energy NXD 93
        4 Blend Energy WLFM DRX 118
        1 Double Colorless Energy NXD 92`,
    'Blastoise Keldeo': `
        Pokémon (14)
        4 Squirtle BCR 29
        1 Wartortle BCR 30
        4 Blastoise BCR 31
        3 Keldeo-EX BCR 49
        2 Black Kyurem-EX PLS 95
        
        Trainer (35)
        4 Skyla BCR 134
        3 Professor Juniper DEX 98
        3 N DEX 96
        1 Colress PLS 118
        1 Cilan NXD 86
        4 Rare Candy DEX 100
        4 Superior Energy Retrieval PLF 103
        3 Pokémon Catcher EPO 95
        3 Ultra Ball DEX 102
        1 Heavy Ball NXD 88
        1 Level Ball NXD 89
        1 Tool Scrapper DRX 116
        1 Energy Search BCR 128
        1 Computer Search BCR 137
        4 Tropical Beach PR-BLW 50
        
        Energy (11)
        9 Water Energy 3
        2 Lightning Energy 4`,
    'Sableye Garbodor': `
        Pokémon (11)
        4 Sableye DEX 62
        2 Trubbish DRX 53
        2 Garbodor DRX 54
        2 Darkrai-EX DEX 63
        1 Sneasel NXD 69
        
        Trainer (41)
        4 Professor Juniper DEX 98
        4 N DEX 96
        2 Skyla BCR 134
        1 Ghetsis PLF 101
        4 Pokémon Catcher EPO 95
        3 Crushing Hammer EPO 92
        3 Hypnotoxic Laser PLS 123
        3 Ultra Ball DEX 102
        2 Dark Patch DEX 93
        2 Enhanced Hammer DEX 94
        2 Random Receiver DEX 99
        1 Energy Search BCR 128
        1 Super Rod DRV 20
        1 Switch BCR 135
        1 Tool Scrapper DRX 116
        4 Float Stone PLF 99
        1 Life Dew PLF 107
        2 Virbank City Gym PLS 126
        
        Energy (8)
        8 Darkness Energy 7`,
    'Rayquaza Eelektrik': `
        Pokémon (15)
        4 Tynamo DEX 45
        4 Eelektrik NVI 40
        3 Rayquaza-EX DRX 85
        2 Keldeo-EX BCR 49
        1 Raikou-EX DEX 38
        1 Rayquaza DRV 11
        
        Trainer (33)
        4 Professor Juniper DEX 98
        4 N DEX 96
        3 Colress PLS 118
        4 Ultra Ball DEX 102
        4 Level Ball NXD 89
        3 Pokémon Catcher EPO 95
        2 Super Rod DRV 20
        1 Energy Search BCR 128
        1 Max Potion EPO 94
        1 Computer Search BCR 137
        3 Float Stone PLF 99
        3 Tropical Beach PR-BLW 50
        
        Energy (12)
        8 Lightning Energy 4
        4 Fire Energy 2`,
    Flareon: `
        Pokémon (25)
        4 Eevee PLF 90
        4 Flareon PLF 12
        1 Leafeon PLF 11
        1 Espeon DEX 48
        4 Audino BCR 126
        3 Drifloon DRX 50
        2 Drifblim DRX 51
        2 Trubbish DRX 53
        1 Garbodor DRX 54
        1 Landorus-EX BCR 89
        1 Terrakion NVI 73
        1 Mr. Mime PLF 47
        
        Trainer (27)
        4 Professor Juniper DEX 98
        4 N DEX 96
        2 Colress PLS 118
        4 Ultra Ball DEX 102
        3 Enhanced Hammer DEX 94
        2 Pokémon Catcher EPO 95
        2 Random Receiver DEX 99
        1 Super Rod DRV 20
        1 Computer Search BCR 137
        2 Float Stone PLF 99
        2 Tropical Beach PR-BLW 50
        
        Energy (8)
        4 Double Colorless Energy NXD 92
        4 Fighting Energy 6`,
    Klinklang: `
        Pokémon (18)
        4 Klink DEX 75
        2 Klang DEX 76
        2 Klinklang BLW 76
        2 Klinklang PLS 90
        3 Keldeo-EX BCR 49
        2 Cobalion-EX PLS 93
        2 Darkrai-EX DEX 63
        1 Raikou-EX DEX 38
        
        Trainer (32)
        4 N DEX 96
        3 Colress PLS 118
        3 Skyla BCR 134
        1 Professor Juniper DEX 98
        3 Heavy Ball NXD 88
        3 Rare Candy DEX 100
        3 Max Potion EPO 94
        3 Pokémon Catcher EPO 95
        1 Ultra Ball DEX 102
        1 Super Rod DRV 20
        1 Dowsing Machine PLS 128
        1 Float Stone PLF 99
        1 Giant Cape DRX 114
        4 Tropical Beach PR-BLW 50
        
        Energy (10)
        5 Metal Energy 8
        4 Prism Energy NXD 93
        1 Blend Energy WLFM DRX 118`,
  },
  '2011-2012 B&W': {
    'Darkrai Mewtwo Terrakion': `
        Pokémon (12)
        3 Darkrai-EX DEX 63
        3 Mewtwo-EX NXD 54
        2 Terrakion NVI 73
        2 Shaymin UL 8
        2 Smeargle CL 21
        
        Trainer (34)
        4 Professor Oak's New Theory CL 83
        3 Professor Juniper DEX 98
        2 N DEX 96
        4 Junk Arm TM 87
        4 Dark Patch DEX 93
        3 Pokémon Catcher EPO 95
        2 Random Receiver DEX 99
        2 PlusPower BLW 96
        2 Switch BLW 104
        2 Super Scoop Up BLW 103
        2 Ultra Ball DEX 102
        1 Dual Ball CL 78
        3 Eviolite NVI 91
        
        Energy (14)
        7 Darkness Energy 7
        3 Double Colorless Energy NXD 92
        2 Prism Energy NXD 93
        2 Fighting Energy 6`,
    'Darkrai Mewtwo': `
        Pokémon (10)
        3 Darkrai-EX DEX 63
        3 Mewtwo-EX NXD 54
        2 Shaymin UL 8
        2 Smeargle CL 21
        
        Trainer (37)
        4 Professor Juniper DEX 98
        4 N DEX 96
        2 Professor Oak's New Theory CL 83
        4 Junk Arm TM 87
        4 Dark Patch DEX 93
        3 Pokémon Catcher EPO 95
        3 Ultra Ball DEX 102
        2 Random Receiver DEX 99
        2 PlusPower BLW 96
        2 Switch BLW 104
        2 Potion BLW 100
        1 Max Potion EPO 94
        1 Lost Remover CL 80
        3 Eviolite NVI 91
        
        Energy (13)
        9 Darkness Energy 7
        4 Double Colorless Energy NXD 92`,
    'Celebi Mewtwo Terrakion': `
        Pokémon (17)
        3 Celebi TM 92
        3 Mewtwo-EX NXD 54
        2 Terrakion NVI 73
        2 Smeargle CL 21
        1 Tornadus-EX DEX 90
        1 Tornadus EPO 89
        1 Virizion NVI 13
        1 Bouffalant BLW 91
        1 Shaymin UL 8
        1 Eevee UD 48
        1 Espeon DEX 48
        
        Trainer (30)
        4 Professor Juniper DEX 98
        4 N DEX 96
        2 Professor Oak's New Theory CL 83
        3 Junk Arm TM 87
        3 Pokémon Catcher EPO 95
        3 Switch BLW 104
        2 Dual Ball CL 78
        2 PlusPower BLW 96
        1 Random Receiver DEX 99
        1 Level Ball NXD 89
        1 Energy Search BLW 93
        1 Super Rod NVI 95
        1 Eviolite NVI 91
        2 Skyarrow Bridge NXD 91
        
        Energy (13)
        6 Grass Energy 1
        4 Double Colorless Energy NXD 92
        3 Fighting Energy 6`,
    'Chandelure Accelgor Lock': `
        Pokémon (26)
        4 Mew TM 97
        3 Accelgor DEX 11
        3 Litwick PR-BLW 27
        2 Lampent NVI 59
        2 Chandelure NVI 60
        3 Oddish UD 60
        2 Vileplume UD 24
        2 Darkrai-EX DEX 63
        1 Relicanth CL 69
        1 Pichu HS 28
        1 Smeargle CL 21
        1 Shaymin UL 8
        1 Terrakion NVI 73
        
        Trainer (24)
        4 Twins TM 89
        4 Professor Oak's New Theory CL 83
        4 Sage's Training CL 85
        3 Professor Juniper DEX 98
        4 Pokémon Communication BLW 99
        4 Rare Candy DEX 100
        1 Tropical Beach PR-BLW 50
        
        Energy (10)
        4 Rainbow Energy HS 104
        4 Double Colorless Energy NXD 92
        2 Prism Energy NXD 93`,
  },

  '2010-2011 HS': {
    'Yanmega Weavile': `
        Pokémon (20)
        4 Yanma hgss4-84
        4 Yanmega hgss4-98
        4 Sneasel hgss3-68
        4 Weavile hgss3-25
        2 Slowpoke hgss3-66
        2 Slowking col1-32

        Trainer (30)
        4 Pokémon Collector hgss1-97
        4 Judge hgss2-78
        4 Professor Oak's New Theory col1-83
        3 Copycat col1-77
        3 Professor Elm's Training Method hgss1-100
        4 Pokémon Communication hgss1-98
        4 Super Scoop Up hgss2-83
        2 Junk Arm hgss4-87
        2 Lost Remover col1-80

        Energy (10)
        5 Grass Energy hgss1-115
        3 Rescue Energy hgss4-90
        1 Rainbow Energy hgss1-104
        1 Psychic Energy hgss1-119
    `,
    'Yanmega Magnezone': `
        Pokémon (17)
        4 Yanma hgss4-84
        4 Yanmega hgss4-98
        3 Magnemite hgss4-68
        1 Magneton hgss4-43
        3 Magnezone hgss4-96
        1 Horsea hgss2-49
        1 Kingdra hgss2-85

        Trainer (27)
        4 Pokémon Collector hgss1-97
        4 Professor Oak's New Theory col1-83
        3 Judge hgss2-78
        3 Sage's Training hgss3-77
        4 Rare Candy hgss2-82
        4 Pokémon Communication hgss1-98
        3 Junk Arm hgss4-87
        2 Pokémon Reversal hgss1-99

        Energy (16)
        11 Lightning Energy hgss1-118
        2 Rainbow Energy hgss1-104
        3 Psychic Energy hgss1-119
    `,
    'Vileplume Yanmega': `
        Pokémon (24)
        4 Yanma hgss4-84
        4 Yanmega hgss4-98
        3 Oddish hgss3-60
        1 Gloom hgss3-27
        2 Vileplume hgss3-24
        1 Bellossom hgss3-1
        2 Sunkern hgss1-85
        2 Sunflora hgss1-31
        2 Mew hgss4-97
        1 Cleffa hgss1-17
        1 Aipom hgss2-43
        1 Muk hgss3-31

        Trainer (27)
        4 Pokémon Collector hgss1-97
        3 Copycat col1-77
        3 Judge hgss2-78
        3 Professor Oak's New Theory col1-83
        3 Sage's Training hgss3-77
        3 Twins hgss4-89
        4 Pokémon Communication hgss1-98
        4 Rare Candy hgss2-82

        Energy (9)
        5 Psychic Energy hgss1-119
        3 Rescue Energy hgss4-90
        1 Rainbow Energy hgss1-104
    `,
    'Typhlosion, Rayquaza & Deoxys-LEGEND': `
        Pokémon (19)
        4 Cyndaquil hgss1-61
        2 Quilava hgss1-49
        4 Typhlosion hgss1-110
        2 Vulpix hgss2-68
        2 Ninetales hgss1-7
        2 Rayquaza & Deoxys-LEGEND UD 89
        2 Rayquaza & Deoxys-LEGEND UD 90 
        1 Cleffa HS 17

        Trainer (23)
        4 Pokémon Collector hgss1-97
        4 Professor Elm's Training Method hgss1-100
        3 Sage's Training hgss3-77
        2 Flower Shop Lady hgss3-74
        4 Pokémon Communication hgss1-98
        4 Rare Candy hgss2-82
        2 Burned Tower UD 71

        Energy (18)
        15 Fire Energy hgss1-116
        3 Lightning Energy hgss1-118
    `,
    'Leafeon, Roserade, & Houndoom': `
        Pokémon (20)
        4 Eevee hgss3-48
        3 Leafeon hgss3-17
        1 Espeon hgss3-81
        2 Roselia hgss2-61
        2 Roserade hgss2-23
        2 Houndour hgss3-54
        2 Houndoom hgss3-82
        1 Venonat hgss4-81
        1 Venomoth hgss4-11
        1 Cleffa hgss1-17
        1 Celebi hgss4-92

        Trainer (25)
        4 Pokémon Collector hgss1-97
        4 Professor Oak’s New Theory col1-83
        4 Professor Elm’s Training Method hgss1-100
        1 Twins hgss4-89
        1 Seeker hgss4-88
        4 Pokémon Communication hgss1-98
        3 Pokémon Reversal hgss1-99
        2 Pokegear hgss1-96
        2 Energy Exchanger hgss3-73

        Energy (15)
        6 Grass Energy hgss1-115
        1 Psychic Energy hgss1-119
        4 Rainbow Energy hgss1-104
        3 Rescue Energy hgss4-90
        1 Double Colorless Energy hgss1-103
        `,
    'Magnezone Pachirisu': `
        Pokémon (18)
        4 Magnemite hgss4-68
        1 Magneton hgss4-43
        4 Magnezone hgss4-96
        4 Pachirisu col1-18
        2 Voltorb hgss4-83
        2 Electrode hgss4-93
        1 Cleffa hgss1-17

        Trainer (19)
        4 Pokémon Collector hgss1-97
        4 Judge hgss2-78
        3 Twins hgss4-89
        4 Rare Candy hgss2-82
        4 Pokémon Communication hgss1-98

        Energy (23)
        23 Lightning Energy hgss1-118
    `,
    'Lanturn Feraligatr': `
        Pokémon (18)
        4 Chinchou hgss2-48
        4 Lanturn hgss2-86
        3 Totodile hgss1-86
        1 Croconaw hgss1-38
        3 Feraligatr hgss1-108
        2 Cleffa hgss1-17
        1 Smeargle hgss3-8

        Trainer (25)
        4 Pokémon Collector hgss1-97
        4 Professor Oak’s New Theory col1-83
        3 Professor Elm’s Training Method hgss1-100
        2 Fisherman hgss1-92
        2 Interviewer’s Questions hgss2-77
        4 Pokémon Communication hgss1-98
        3 Rare Candy hgss2-82
        2 Pokémon Reversal hgss1-99
        1 Burned Tower hgss3-71

        Energy (17)
        11 Water Energy hgss1-117
        4 Lightning Energy hgss1-118
        2 Double Colorless Energy hgss1-103
    `,
    Gengar: `
        Pokémon (20)
        4 Gastly hgss4-63
        2 Haunter hgss4-35
        4 Gengar hgss4-94
        2 Spiritomb hgss4-10
        1 Oddish hgss3-60
        1 Vileplume hgss3-24
        1 Mime Jr. col1-47
        1 Mr. Mime col1-29
        1 Smeargle hgss3-8
        1 Cleffa hgss1-17
        1 Jirachi hgss2-1
        1 Shaymin hgss2-8

        Trainer (26)
        4 Pokémon Collector hgss1-97
        4 Twins hgss4-89
        4 Professor Oak’s New Theory col1-83
        4 Seeker hgss4-88
        4 Pokémon Communication hgss1-98
        4 Rare Candy hgss2-82
        2 Lost World col1-81

        Energy (14)
        12 Psychic Energy hgss1-119
        2 Rescue Energy hgss4-90
    `,
  },
  '2007-2009 D&P/P': {
    Regigigas: `
        Pokémon (17)
        1 Regigigas dpp-DP40
        1 Regigigas dp6-37
        2 Regigigas Lv.X dp7-100
        4 Mesprit dp6-34
        3 Uxie dp6-43
        1 Uxie Lv.X dp6-146
        1 Azelf dp6-19
        1 Azelf dp2-4
        1 Crobat G pl1-47
        1 Regice dp6-36
        1 Giratina pl1-9
    
        Trainer (28)
        4 Roseanne's Research dp3-125
        4 Felicity's Drawing dp4-98
        4 Cyrus's Initiative pl3-137
        4 Super Scoop Up dp1-115
        4 Time-Space Distortion dp2-124
        3 Premier Ball dp4-101
        2 Luxury Ball dp7-86
        2 Expert Belt pl4-87
        1 Snowpoint Temple dp6-134
    
        Energy (15)
        4 Water Energy dp1-125
        4 Metal Energy dp1-130
        3 Fighting Energy dp1-128
        4 Multi Energy dp2-118`,
    'Palkia Lock': `
        2 Palkia G pl1-12
        2 Palkia G Lv.X pl1-125
        4 Mesprit dp6-34
        3 Uxie dp6-43
        1 Uxie Lv.X dp6-146
        2 Crobat G pl1-47
        1 Azelf dp6-19
        1 Azelf dp2-4
        1 Bronzong G pl1-41
        1 Toxicroak G dpp-DP41
        1 Unown G dp4-57
        1 Unown Q dp5-49
        4 Cyrus's Conspiracy pl1-105
        4 Roseanne's Research dp3-125
        1 Bebe's Search dp3-119
        1 Cynthia's Feelings dp6-131
        1 Aaron's Collection pl2-88
        4 Energy Gain pl1-116
        4 Poke Turn pl1-118
        3 Power Spray pl1-117
        3 SP Radar pl2-96
        1 Luxury Ball dp7-86
        1 Expert Belt pl4-87
        1 VS Seeker pl3-140
        3 Water Energy dp1-125
        2 Psychic Energy dp1-127
        4 Call Energy dp5-92
        3 SP Energy pl2-101
        `,
    'Machamp ': `
        4 Machop dp7-64
        4 Machoke dp7-41
        3 Machamp dp7-20
        1 Machamp Lv.X dp7-98
        3 Spiritomb pl4-32
        2 Baltoy dp4-60
        2 Claydol dp4-15
        1 Finneon dp7-61
        1 Lumineon dp7-4
        1 Relicanth dp7-79
        1 Uxie dp6-43
        1 Azelf dp6-19
        1 Unown Q dp5-49
        3 Broken Time-Space pl1-104
        4 Roseanne's Research dp3-125
        4 Bebe's Search dp3-119
        2 Cynthia's Feelings dp6-131
        1 Looker's Investigation pl1-109
        4 Poke Blower + dp7-88
        1 Luxury Ball dp7-86
        1 Premier Ball dp4-101
        1 Night Maintenance dp3-120
        1 Warp Point dp1-116
        9 Fighting Energy dp1-126
        4 Call Energy dp5-92
        `,
    Luxchomp: `
        2 Luxray GL pl2-9
        2 Luxray GL Lv.X pl2-109
        2 Garchomp C pl3-60
        2 Garchomp C Lv.X pl3-145
        2 Uxie dp6-43
        1 Uxie Lv.X dp6-146
        1 Bronzong G pl1-41
        1 Toxicroak G dpp-DP41
        1 Lucario GL pl2-8
        1 Ambipom G pl2-56
        1 Azelf dp6-19
        1 Unown G dp4-57
        1 Unown Q dp5-49
        4 Cyrus's Conspiracy pl1-105
        4 Roseanne's Research dp3-125
        2 Cynthia's Feelings dp6-131
        2 Bebe's Search dp3-119
        4 Energy Gain pl1-116
        4 Poke Turn pl1-118
        4 Power Spray pl1-117
        3 SP Radar pl2-96
        1 VS Seeker pl3-140
        1 Luxury Ball dp7-86
        4 Lightning Energy dp1-126
        2 Psychic Energy dp1-127
        4 Call Energy dp5-92
        3 SP Energy pl2-101
        `,
    Kingdra: `
        4 Horsea dp6-102
        4 Seadra dp6-70
        4 Kingdra dp6-7
        3 Baltoy dp4-60
        3 Claydol dp4-15
        2 Uxie dp6-43
        1 Uxie Lv.X dp6-146
        1 Regice dp6-36
        1 Unown Q dp5-49
        4 Broken Time-Space pl1-104
        4 Roseanne's Research dp3-125
        4 Bebe's Search dp3-119
        3 Cynthia's Feelings dp6-131
        3 Luxury Ball dp7-86
        3 Super Scoop Up dp1-115
        3 PlusPower dp1-109
        2 Expert Belt pl4-87
        2 Night Maintenance dp3-120
        9 Water Energy dp1-125
        `,
    Gyarados: `
        4 Sableye dp7-48
        4 Magikarp dp7-65
        3 Gyarados dp7-19
        2 Uxie dp6-43
        1 Uxie Lv.X dp6-146
        2 Crobat G pl1-47
        1 Regice dp6-36
        1 Azelf dp6-19
        1 Unown Q dp5-49
        1 Combee dp7-57
        3 Broken Time-Space pl1-104
        4 Roseanne's Research dp3-125
        3 Felicity's Drawing dp4-98
        2 Cynthia's Feelings dp6-131
        2 Bebe's Search dp3-119
        1 Buck's Training dp6-130
        4 Pokémon Rescue pl1-115
        4 Super Scoop Up dp1-115
        3 Poke Turn pl1-118
        3 VS Seeker pl3-140
        3 PlusPower dp1-109
        2 Expert Belt pl4-87
        2 Luxury Ball dp7-86
        2 Darkness Energy dp1-129
        2 Cyclone Energy dp7-94
        `,
    Gliscor: `
        4 Spiritomb pl4-32
        4 Unown Q dp5-49
        4 Gligar dp6-94
        3 Gliscor dp6-5
        1 Gliscor Lv.X dp6-141
        2 Baltoy dp4-60
        2 Claydol dp4-15
        2 Crobat G pl1-47
        1 Uxie dp6-43
        1 Uxie Lv.X dp6-146
        1 Azelf dp6-19
        3 Broken Time-Space pl1-104
        4 Roseanne's Research dp3-125
        4 Bebe's Search dp3-119
        4 Cyrus's Initiative pl3-137
        3 Looker's Investigation pl1-109
        4 Poke Blower + dp7-88
        3 Bench Shield pl4-83
        1 Night Maintenance dp3-120
        1 Luxury Ball dp7-86
        1 Premier Ball dp4-101
        1 Poke Turn pl1-118
        2 Fighting Energy dp1-128
        4 Call Energy dp5-92
        `,
    Gengar: `
        4 Spiritomb pl4-32
        4 Gastly dp7-62
        4 Haunter dp7-40
        2 Gengar dp7-18
        1 Gengar pl4-16
        1 Gengar Lv.X pl4-97
        2 Baltoy dp4-60
        2 Claydol dp4-15
        1 Chansey pl1-69
        1 Blissey pl1-22
        1 Relicanth pl3-79
        1 Unown G dp4-57
        1 Unown Q dp5-49
        1 Azelf dp6-19
        1 Uxie dp6-43
        3 Broken Time-Space pl1-104
        4 Roseanne's Research dp3-125
        4 Bebe's Search dp3-119
        3 Cynthia's Feelings dp6-131
        2 Looker's Investigation pl1-109
        1 Luxury Ball dp7-86
        1 Night Maintenance dp3-120
        1 Expert Belt pl4-87
        1 Switch dp1-119
        7 Psychic Energy dp1-127
        1 Fighting Energy dp1-128
        4 Call Energy dp5-92
        1 Rainbow Energy pl1-121
        `,
    'Gardevoir Gallade': `
        4 Spiritomb pl4-32
        4 Ralts dp3-102
        4 Kirlia dp3-53
        3 Gardevoir dp3-7
        2 Gallade dp3-6
        2 Baltoy dp4-60
        2 Claydol dp4-15
        1 Duskull dp3-86
        1 Dusclops dp7-34
        1 Dusknoir dp1-2
        1 Relicanth pl3-79
        1 Crobat G pl1-47
        1 Unown Q dp5-49
        2 Broken Time-Space pl1-104
        4 Roseanne's Research dp3-125
        4 Bebe's Search dp3-119
        3 Team Galactic's Wager dp2-115
        1 Lucian's Assignment pl2-92
        1 Switch dp1-119
        1 Night Maintenance dp3-120
        1 Luxury Ball dp7-86
        1 Poke Turn pl1-118
        5 Psychic Energy dp1-127
        1 Fighting Energy dp1-128
        4 Call Energy dp5-92
        4 Upper Energy pl2-102
        1 Rainbow Energy pl1-121
        `,
    Flygon: `
        4 Spiritomb pl4-32
        3 Trapinch dp3-115
        3 Vibrava pl2-53
        3 Flygon pl2-5
        1 Flygon Lv.X pl2-105
        2 Machop dp7-64
        2 Machoke dp7-41
        2 Machamp dp7-20
        2 Baltoy dp4-60
        2 Claydol dp4-15
        2 Palkia dp5-11
        2 Palkia Lv.X dp4-106
        1 Unown Q dp5-49
        1 Azelf dp6-19
        4 Roseanne's Research dp3-125
        4 Bebe's Search dp3-119
        3 Cyrus's Initiative pl3-137
        2 Cynthia's Feelings dp6-131
        1 Memory Berry pl1-110
        1 Luxury Ball dp7-86
        1 Premier Ball dp4-101
        1 Night Maintenance dp3-120
        5 Fighting Energy dp1-128
        3 Water Energy dp1-125
        1 Darkness Energy dp1-129
        4 Call Energy dp5-92
        `,
    Dusknoir: `
        4 Spiritomb pl4-32
        4 Duskull dp7-SH2
        4 Dusclops dp7-34
        2 Dusknoir dp7-1
        1 Dusknoir dp1-2
        1 Dusknoir Lv.X dp7-96
        2 Baltoy dp4-60
        2 Claydol dp4-15
        1 Finneon dp7-61
        1 Lumineon dp7-4
        1 Mewtwo dp5-9
        1 Mewtwo Lv.X dp6-144
        1 Unown G dp4-57
        1 Unown Q dp5-49
        1 Azelf dp6-19
        4 Roseanne's Research dp3-125
        4 Bebe's Search dp3-119
        4 Cyrus's Initiative pl3-137
        2 Cynthia's Feelings dp6-131
        1 Looker's Investigation pl1-109
        2 Warp Point dp1-116
        1 Night Maintenance dp3-120
        1 Luxury Ball dp7-86
        10 Psychic Energy dp1-127
        4 Call Energy dp5-92
        `,
    Dialgachomp: `
        2 Dialga G pl1-7
        1 Dialga G Lv.X pl1-122
        2 Garchomp C pl3-60
        2 Garchomp C Lv.X pl3-145
        2 Crobat G pl1-47
        1 Toxicroak G dpp-DP41
        1 Bronzong G pl1-41
        1 Ambipom G pl2-56
        2 Uxie dp6-43
        1 Uxie Lv.X dp6-146
        1 Azelf dp6-19
        1 Unown G dp4-57
        1 Unown Q dp5-49
        4 Cyrus's Conspiracy pl1-105
        4 Roseanne's Research dp3-125
        1 Looker's Investigation pl1-109
        1 Bebe's Search dp3-119
        1 Aaron's Collection pl2-88
        4 Energy Gain pl1-116
        4 Poke Turn pl1-118
        4 Power Spray pl1-117
        3 SP Radar pl2-96
        1 Luxury Ball dp7-86
        1 Expert Belt pl4-87
        1 VS Seeker pl3-140
        3 Psychic Energy dp1-127
        1 Metal Energy dp1-130
        4 Metal Energy dp3-130
        4 Call Energy dp5-92
        1 Warp Energy dp7-95
        `,
    Blazeray: `
        2 Blaziken FB pl3-2
        2 Blaziken FB Lv.X pl3-142
        2 Luxray GL pl2-9
        2 Luxray GL Lv.X pl2-109
        1 Bronzong G pl1-41
        1 Lucario GL pl2-8
        1 Toxicroak G dpp-DP41
        2 Uxie dp6-43
        1 Uxie Lv.X dp6-146
        1 Azelf dp6-19
        1 Unown G dp4-57
        1 Unown Q dp5-49
        4 Cyrus's Conspiracy pl1-105
        4 Roseanne's Research dp3-125
        2 Cynthia's Feelings dp6-131
        1 Bebe's Search dp3-119
        1 Aaron's Collection pl2-88
        4 Energy Gain pl1-116
        4 Poke Turn pl1-118
        4 Power Spray pl1-117
        3 SP Radar pl2-96
        1 Luxury Ball dp7-86
        1 Expert Belt pl4-87
        1 VS Seeker pl3-140
        3 Fire Energy dp1-124
        2 Lightning Energy dp1-126
        1 Psychic Energy dp1-127
        4 Call Energy dp5-92
        3 SP Energy pl2-101
        `,
    Beedrill: `
        4 Weedle dp4-93
        4 Kakuna pl2-66
        2 Beedrill dp4-13
        2 Beedrill pl2-15
        3 Baltoy dp4-60
        3 Claydol dp4-15
        1 Uxie dp6-43
        4 Broken Time-Space pl1-104
        4 Roseanne's Research dp3-125
        4 Bebe's Search dp3-119
        3 Cynthia's Feelings dp6-131
        4 Quick Ball dp2-114
        4 Poke Drawer + dp7-89
        4 Night Maintenance dp3-120
        3 PlusPower dp1-109
        2 Warp Point dp1-116
        2 Expert Belt pl4-87
        1 Luxury Ball dp7-86
        4 Grass Energy dp1-123
        2 Multi Energy dp2-118
        `,
    AMU: `
        3 Uxie dp6-43
        1 Uxie Lv.X dp6-146
        2 Mesprit dp6-34
        1 Mesprit dp2-14
        1 Mesprit Lv.X dp6-143
        2 Azelf dp6-19
        1 Azelf dp2-4
        1 Azelv Lv.X dp6-140
        2 Snowpoint Temple dp6-134
        4 Roseanne's Research dp3-125
        4 Cynthia's Feelings dp6-131
        1 Looker's Investigation pl1-109
        4 Poke Drawer + dp7-89
        4 Energy Pickup dp6-132
        4 Premier Ball dp4-101
        3 Time-Space Distortion dp2-124
        3 Energy Switch dp1-107
        2 Switch dp1-119
        1 Warp Point dp1-116
        1 Luxury Ball dp7-86
        1 Night Maintenance dp3-120
        14 Psychic Energy dp1-127
        `,
    'Abomasnow Ampharos': `
        4 Spiritomb pl4-32
        3 Mareep pl1-82
        3 Flaaffy dp3-50
        4 Snover dp7-74
        4 Abomasnow dp7-12
        2 Nidoran F pl2-71
        2 Nidorina pl2-73
        2 Nidoqueen pl2-30
        2 Bronzor dp5-52
        2 Bronzong dp5-16
        2 Baltoy dp4-60
        2 Claydol dp4-15
        1 Unown Q dp5-49
        4 Roseanne's Research dp3-125
        4 Bebe's Search dp3-119
        3 Cytnhia's Feelings dp6-131
        1 Switch dp1-119
        1 Night Maintenance dp3-120
        1 Luxury Ball dp7-86
        2 Psychic Energy dp1-127
        2 Lightning Energy dp1-126
        4 Call Energy dp5-92
        4 Upper Energy pl2-102
        1 Warp Energy dp7-95
        `,
  },
  '2003-2007 ex': {
    'Shiftry ex': `
        4 Seedot ex8-71
        2 Nuzleaf ex12-41
        4 Shiftry ex ex14-97
        3 Lickitung ex15-19
        2 Pidgey ex6-73
        1 Pidgeotto ex6-45
        2 Pidgeot ex6-10
        1 Absol ex ex16-92
        1 Holon's Magnemite ex11-70
        1 Holon's Magneton ex11-22
        3 Crystal Beach ex14-75
        4 Rocket's Admin. ex7-86
        4 Professor Elm's Training Method ex10-89
        2 Holon Mentor ex11-93
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        4 Rare Candy ex9-83
        4 Holon Transceiver ex11-98
        2 Pow! Hand Extension ex7-85
        1 Windstorm ex14-85
        5 Psychic Energy ex1-107
        4 Darkness Energy ex16-87
        4 Multi Energy ex16-89
        `,
    'Scrambled Eggs': `
        3 Exeggcute ex13-65
        1 Exeggcute ex6-33
        4 Exeggutor ex6-5
        3 Voltorb ex5-80
        3 Electrode ex ex6-107
        1 Magnetic Storm ex5-91
        4 Rocket's Admin. ex7-86
        4 TV Reporter ex3-88
        3 Professor Elm's Training Method ex10-89
        3 Castaway ex14-72
        4 Cessation Crystal ex14-74
        4 Pow! Hand Extension ex7-85
        3 Great Ball ex6-92
        2 Poke Ball ex6-95
        2 Windstorm ex14-85
        1 Energy Root ex10-83
        3 Psychic Energy ex1-107
        2 Lightning Energy ex1-109
        4 Scramble Energy ex8-95
        3 Double Rainbow Energy ex14-88
        3 Heal Energy ex8-94
       `,
    Rayler: `
        4 Stantler ex10-32
        3 Rayquaza ex ex15-97
        2 Minun ex8-41
        1 Unown ex10-E
        3 Cursed Stone ex12-72
        2 Crystal Beach ex14-75
        4 Castaway ex14-72
        4 Rocket's Admin. ex7-86
        2 Pokémon Fan Club pop4-9
        1 Lanette's Net Search ex2-87
        1 Steven's Advice ex5-92
        1 Mary's Request ex10-86
        1 TV Reporter ex3-88
        1 Scott ex9-84
        1 Mr. Stone's Project ex15-77
        4 Pow! Hand Extension ex7-85
        4 Energy Removal 2 ex16-74
        4 Cessation Crystal ex14-74
        2 Balloon Berry ex8-84
        1 Super Scoop Up ex11-100
        14 Lightning Energy ex1-109
       `,
    'Rai-Eggs': `
        3 Pikachu ex13-79
        1 Pikachu ex12-93
        3 Raichu ex13-15
        3 Exeggcute ex13-65
        3 Exeggutor ex13-41
        4 Holon's Castform ex13-44
        3 Holon's Magnemite ex11-70
        4 Cursed Stone ex12-72
        4 Rocket's Admin. ex7-86
        3 Holon Mentor ex11-93
        2 Holon Researcher ex11-95
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        2 Steven's Advice ex5-92
        4 Cessation Crystal ex14-74
        4 Holon Transceiver ex11-98
        2 Swoop! Teleporter ex7-92
        2 Pokémon Retriever ex7-84
        4 Metal Energy ex16-88
        4 Scramble Energy ex8-95
        3 Double Rainbow Energy ex14-88
       `,
    Queendom: `
        4 Nidoran♀ ex6-70
        2 Nidorina ex6-40
        4 Nidoqueen ex6-9
        3 Pidgey ex6-73
        1 Pidgeotto ex6-45
        3 Pidgeot ex6-10
        1 Feebas ex9-49
        1 Milotic ex5-12
        1 Holon's Magneton ex11-22
        4 Desert Ruins ex5-88
        4 Celio's Network ex6-88
        3 Rocket's Admin. ex7-86
        3 Steven's Advice ex16-83
        2 Copycat ex7-83
        1 Mr. Briney's Compassion ex3-87
        4 Rare Candy ex9-83
        3 Great Ball ex6-92
        1 Windstorm ex14-85
        1 VS Seeker ex6-100
        6 Grass Energy ex1-104
        1 Fighting Energy ex1-105
        4 Double Rainbow Energy ex14-88
        2 Heal Energy ex8-94
        1 Scramble Energy ex8-95
       `,
    'Mew Lock': `
        4 Mew ex ex12-88
        4 Holon's Castform ex13-44
        4 Holon's Magnemite ex11-70
        3 Holon's Voltorb ex11-71
        2 Wynaut ex12-71
        2 Wobbuffet ex12-28
        2 Jynx ex10-28
        2 Minun ex8-41
        1 Roselia ex12-42
        1 Unown ex10-E
        1 Stantler ex10-32
        1 Girafarig ex12-16
        1 Lapras ex12-8
        4 Battle Frontier ex9-75
        4 Rocket's Admin. ex7-86
        4 Holon Mentor ex11-93
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        4 Holon Transceiver ex11-98
        4 Pow! Hand Extension ex7-85
        3 Swoop! Teleporter ex7-92
        3 Pokémon Retriever ex7-84
        1 Warp Point ex14-84
        1 Windstorm ex14-85
        1 Super Scoop Up ex11-100
        1 Warp Energy ex16-91
       `,
    Mewtric: `
        4 Electrike ex8-59
        4 Manectric ex ex8-101
        2 Lunatone ex12-20
        1 Solrock ex12-25
        1 Mew ex ex12-88
        1 Girafarig ex12-16
        1 Lapras ex12-8
        1 Tropius ex15-23
        1 Holon's Magneton ex11-22
        2 Cursed Stone ex12-72
        2 Crystal Beach ex14-75
        4 Rocket's Admin. ex7-86
        4 Professor Elm's Training Method ex10-89
        2 Copycat ex7-83
        2 Scott ex9-84
        1 Steven's Advice ex16-83
        1 TV Reporter ex3-88
        4 Dual Ball ex4-72
        3 Swoop! Teleporter ex7-92
        2 Switch ex1-92
        1 Pow! Hand Extension ex7-85
        1 Pokémon Retriever ex7-84
        11 Lightning Energy ex1-109
        4 Multi Energy ex16-89
       `,
    Metanite: `
        1 Rayquaza  ex8-107
        3 Dratini ex11-66
        1 Dragonair ex11-42
        3 Dragonite ex11-3
        4 Beldum ex11-59
        2 Metang ex11-49
        3 Metagross ex11-11
        1 Metagross ex8-11
        2 Holon's Castform ex13-44
        1 Mew pop5-3
        1 Jirachi ex8-9
        1 Holon's Voltorb ex11-71
        3 Holon Mentor ex11-93
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        1 Holon Researcher ex11-95
        3 Rocket's Admin. ex7-86
        1 Celio's Network ex6-88
        4 Holon Transceiver ex11-98
        4 Rare Candy ex9-83
        3 Windstorm ex14-85
        2 Warp Point ex14-84
        10 Lightning Energy ex1-109
        4 Metal Energy ex16-88
       `,
    'Medicham ex': `
        4 Jirachi ex8-9
        3 Meditite ex16-55
        1 Meditite ex9-55
        4 Medicham ex ex9-95
        1 Wobbuffet ex16-24
        1 Holon's Magneton ex11-22
        3 Island Cave ex5-89
        1 Team Aqua Hideout ex4-78
        4 Rocket's Admin. ex7-86
        4 Professor Elm's Training Method ex10-89
        3 Mary's Request ex10-86
        2 Steven's Advice ex16-83
        2 Scott ex9-84
        4 Pow! Hand Extension ex7-92
        4 Swoop! Teleporter ex7-85
        4 Energy Removal 2 ex16-74
        6 Fighting Energy ex1-105
        5 Psychic Energy ex1-107
        4 Metal Energy ex16-88
       `,
    Ludicargo: `
        1 Umbreon pop5-17
        4 Lotad ex14-55
        2 Lombre ex14-37
        3 Ludicolo ex8-10
        1 Ludicolo ex8-19
        2 Slugma ex10-73
        2 Magcargo ex8-20
        1 Magcargo ex10-41
        2 Jirachi ex8-9
        1 Celebi ex pop2-17
        1 Holon's Voltorb ex11-71
        1 Holon's Castform ex13-44
        3 Battle Frontier ex9-75
        4 Lanette's Net Search ex2-87
        4 Celio's Network ex6-88
        3 Rocket's Admin. ex7-86
        1 Mr. Briney's Compassion ex3-87
        1 Solid Rage ex10-92
        4 Rare Candy ex9-83
        2 VS Seeker ex6-100
        2 Windstorm ex14-85
        1 Pow! Hand Extension ex7-85
        1 Pokémon Retriever ex7-84
        1 Warp Point ex14-84
        6 Water Energy ex1-106
        4 Double Rainbow Energy ex14-88
        2 Scramble Energy ex8-95
       `,
    Imprison: `
        1 Mew ex15-101
        4 Ralts ex15-61
        2 Kirlia ex15-33
        2 Gardevoir ex ex15-93
        2 Gardevoir ex11-6
        4 Holon's Castform ex13-44
        2 Pidgey ex13-77
        1 Pidgeotto ex13-49
        2 Pidgeot ex6-10
        1 Jirachi ex8-9
        1 Jirachi ex ex14-94
        1 Holon's Magnemite ex11-70
        4 Rocket's Admin. ex7-86
        3 Professor Elm's Training Method ex10-89
        3 Holon Mentor ex11-93
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        1 Holon Researcher ex11-95
        4 Holon Transceiver ex11-98
        4 Rare Candy ex9-83
        3 Windstorm ex14-85
        1 Warp Point ex14-84
        1 Swoop! Teleporter ex7-92
        6 Psychic Energy ex1-107
        2 Metal Energy ex16-88
        3 Warp Energy ex16-91
       `,
    Flariados: `
        4 Eevee ex11-69
        4 Flareon ex ex11-108
        1 Espeon ex ex10-102
        4 Spinarak ex10-75
        4 Ariados ex10-2
        1 Ditto ex6-4
        1 Girafarig ex12-16
        1 Holon's Magneton ex11-22
        4 Battle Frontier ex9-75
        4 Professor Elm's Training Method ex10-89
        4 Rocket's Admin. ex7-86
        4 Mary's Request ex10-86
        3 Steven's Advice ex16-83
        4 Super Scoop Up ex11-100
        3 Great Ball ex6-92
        2 Windstorm ex14-85
        6 Grass Energy ex1-104
        2 Fire Energy ex1-108
        4 Multi Energy ex16-89
       `,
    'Eeveelutions Absol ex': `
        1 Jolteon Star ex16-101
        4 Eevee ex11-69
        3 Jolteon ex ex11-109
        1 Umbreon ex ex10-112
        1 Espeon ex ex10-102
        2 Rayquaza ex ex15-97
        2 Absol ex ex16-92
        1 Girafarig ex12-16
        1 Lapras ex12-8
        1 Tauros ex14-12
        1 Holon's Magneton ex11-22
        1 Giant Stump ex12-75
        4 Rocket's Admin. ex7-86
        4 Professor Elm's Training Method ex10-89
        3 Holon Mentor ex11-93
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        1 Holon Researcher ex11-95
        4 Holon Transceiver ex11-98
        4 Super Scoop Up ex11-100
        2 Windstorm ex14-85
        2 Warp Point ex14-84
        1 Pokémon Retriever ex7-84
        10 Lightning Energy ex1-109
        4 Multi Energy ex16-89
       `,
    Dragtrode: `
        4 Rocket's Sneasel ex ex7-103
        3 Dratini ex7-53
        3 Dark Dragonair ex7-31
        2 Dark Dragonite ex7-15
        1 Voltorb ex12-68
        1 Voltorb ex6-85
        2 Dark Electrode ex7-4
        1 Rocket's Scyther ex ex7-102
        4 Desert Ruins ex5-88
        4 Rocket's Admin. ex7-86
        3 Holon Mentor ex11-93
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        2 Steven's Advice ex16-83
        1 Mr. Briney's Compassion ex3-87
        4 Holon Transceiver ex11-98
        4 Rocket's Poke Ball ex7-89
        2 Warp Point ex14-84
        1 Windstorm ex14-85
        1 VS Seeker ex6-100
        4 Darkness Energy ex16-87
        4 Dark Metal Energy ex7-94
        4 Rainbow Energy ex12-81
        3 R Energy ex7-95
       `,
    'Dragonite ex δ': `
        4 Dratini ex11-65
        1 Dragonair ex11-42
        4 Dragonite ex ex15-91
        4 Holon's Castform ex13-44
        2 Holon's Voltorb ex11-71
        2 Lunatone ex12-20
        1 Solrock ex12-25
        1 Girafarig ex12-16
        1 Latios ex ex15-96
        1 Latias ex13-11
        2 Crystal Beach ex14-75
        2 Cursed Stone ex12-72
        4 Rocket's Admin. ex7-86
        2 Scott ex9-84
        2 Holon Researcher ex11-95
        2 Holon Mentor ex11-93
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        1 Holon Farmer ex11-91
        4 Holon Transceiver ex11-98
        4 Rare Candy ex13-90
        4 Swoop! Teleporter ex7-92
        2 Grass Energy ex1-104
        4 δ Rainbow Energy ex15-88
        4 Warp Energy ex16-91
       `,
    Camler: `
        4 Numel ex3-70
        3 Camerupt ex8-4
        4 Stantler ex10-32
        1 Unown ex10-E
        3 Team Aqua Hideout ex4-78
        2 Cursed Stone ex12-72
        4 Castaway ex14-72
        4 Rocket's Admin. ex7-86
        2 Scott ex9-84
        2 Celio's Network ex6-88
        1 Pokémon Fan Club pop4-9
        1 Lanette's Net Search ex2-87
        1 Steven's Advice ex16-83
        1 Mary's Request ex10-86
        4 Energy Removal 2 ex16-74
        4 Pow! Hand Extension ex7-85
        4 Cessation Crystal ex14-74
        2 Fluffy Berry ex10-85
        10 Fire Energy ex1-108
        3 Heal Energy ex8-94
        `,
    Bombtar: `
        2 Larvitar ex11-73
        1 Larvitar ex7-63
        3 Dark Pupitar ex7-41
        3 Dark Tyranitar ex7-19
        2 Voltorb ex7-80
        2 Electrode ex ex6-107
        2 Jirachi ex8-9
        1 Lapras ex12-8
        1 Holon's Magnemite ex11-70
        4 Rocket's Admin. ex7-86
        2 Professor Elm's Training Method ex10-89
        2 Holon Mentor ex11-93
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        4 Pow! Hand Extension ex7-85
        4 Holon Transceiver ex11-98
        2 Windstorm ex14-85
        2 Swoop! Teleporter ex7-92
        2 Rocket's Poke Ball ex7-89
        2 Cessation Crystal ex14-74
        1 VS Seeker ex6-100
        1 Pokémon Retriever ex7-84
        3 Fire Energy ex1-108
        4 Darkness Energy ex16-87
        4 Scramble Energy ex8-95
        2 Holon Energy FF ex15-84
        2 Heal Energy ex8-94
        `,
    'Blastoise ex Lugia ex': `
        1 Latias ex8-105
        3 Holon's Castform ex13-44
        2 Squirtle ex6-83
        2 Blastoise ex ex6-104
        2 Pidgey ex6-73
        1 Pidgeotto ex6-45
        2 Pidgeot ex6-10
        2 Lugia ex ex10-105
        2 Jirachi ex8-9
        1 Kyogre ex ex14-95
        1 Chimecho ex13-37
        1 Tauros ex14-12
        1 Aipom ex10-34
        1 Lapras ex12-8
        1 Holon's Magnemite ex11-70
        1 Power Tree ex12-76
        1 Giant Stump ex12-75
        4 Holon Mentor ex11-93
        1 Holon Adventurer ex13-85
        1 Holon Scientist ex11-97
        2 Rocket's Admin. ex7-86
        2 Professor Elm's Training Method ex10-89
        2 Steven's Advice ex5-92
        4 Holon Transceiver ex11-98
        4 Rare Candy ex9-83
        3 Warp Point ex14-84
        3 Windstorm ex14-85
        3 Pokémon Retriever ex7-84
        1 Swoop! Teleporter ex7-92
        5 Water Energy ex1-106
        `,
    'Arcanine ex Houndoom': `
        4 Growlithe ex12-55
        4 Arcanine ex ex12-83
        2 Houndour ex10-60
        2 Houndoom ex10-7
        1 Aipom ex10-34
        1 Holon's Electrode ex11-21
        2 Cursed Stone ex12-72
        2 Crystal Beach ex14-75
        1 Battle Frontier ex9-75
        4 Professor Elm's Training Method ex10-89
        4 Rocket's Admin. ex7-86
        3 Mary's Request ex10-86
        3 Scott ex9-84
        2 Copycat ex7-83
        4 Energy Removal 2 ex16-74
        3 Great Ball ex6-92
        1 Warp Point ex14-84
        1 Potion ex14-87
        12 Fire Energy ex1-108
        4 React Energy ex12-82
        `,
    'Magma Spirit Deck': `
        Pokémon - 15

        2 Team Magma's Baltoy ex4-32
        2 Team Magma's Camerupt ex4-19
        2 Team Magma's Claydol ex4-8
        4 Team Magma's Groudon ex4-9
        1 Team Magma's Numel ex4-64
        4 Team Magma's Zangoose ex4-23
        
        Trainer - 28
        2 Copycat ecard1-138
        3 Desert Ruins ex5-88
        2 Maxie ex4-73
        2 Mr. Briney's Compassion ex3-87
        3 Pokémon Reversal ex1-87
        3 Steven's Advice ex16-83
        1 Switch base1-95
        3 TV Reporter ex15-82
        2 Team Magma Ball ex4-80
        4 Team Magma Conspirator ex4-82
        3 Underground Expedition ecard3-140
        
        Energy - 17
        4 Darkness Energy col1-86
        6 Fighting Energy base1-97
        4 Magma Energy ex4-87
        1 Psychic Energy base1-101
        2 Rainbow Energy ex7-80
        `,
  },

  '2003 e-Card': {
    'Typhlosion Ninetales': `
        2 Cyndaquil ecard1-104
        2 Cyndaquil ecard1-105
        4 Quilava ecard1-91
        3 Typhlosion ecard1-65
        4 Vulpix ecard1-136
        3 Ninetales ecard1-57
        2 Ponyta ecard2-102
        2 Rapidash ecard2-31
        1 Lapras ecard3-71
        4 Pokémon Fan Club ecard2-130
        4 Professor Elm's Training Method ecard1-148
        4 Professor Oak's Research ecard1-149
        4 Town Volunteers ecard2-136
        2 Underground Expedition ecard3-140
        2 Copycat ecard1-138
        1 Pokémon Nurse ecard1-145
        12 Fire Energy ecard1-161
        4 Warp Energy ecard2-147
        `,
    'Scizor Furret': `
        4 Scyther ecard2-106
        3 Scizor ecard2-32
        2 Eevee ecard2-75
        2 Vaporeon ecard3-33
        1 Flareon ecard3-8
        2 Sentret ecard2-107
        2 Furret ecard2-48
        2 Porygon ecard2-103
        2 Porygon2 ecard2-28
        4 Pokémon Fan Club ecard2-130
        4 Professor Elm's Training Method ecard1-148
        4 Professor Oak's Research ecard1-149
        3 Underground Expedition ecard3-140
        2 Oracle ecard3-138
        1 Desert Shaman ecard3-123
        3 Power Charge ecard1-147
        2 Pokémon Reversal ecard1-146
        2 Friend Ball ecard3-126
        1 Potion ecard1-156
        1 Strength Charm ecard1-150
        4 Metal Energy ecard2-143
        4 Rainbow Energy ecard2-144
        2 Cyclone Energy ecard3-143
        2 Warp Energy ecard2-147
        1 Water Energy ecard1-165
        `,
    'Kingdra Espeon': `
        4 Horsea ecard2-84
        4 Seadra ecard2-58
        4 Kingdra ecard2-19
        3 Eevee ecard2-75
        2 Espeon ecard2-11
        1 Flareon ecard3-8
        2 Lapras ecard3-71
        1 Moltres ecard3-21
        1 Zapdos ecard2-44
        4 Pokémon Fan Club ecard2-130
        4 Professor Elm's Training Method ecard1-148
        4 Professor Oak's Research ecard1-149
        3 Pokémon Nurse ecard1-145
        3 Underground Expedition ecard3-140
        2 Copycat ecard1-138
        1 Super Energy Removal 2 ecard2-134
        8 Water Energy ecard1-165
        4 Rainbow Energy ecard2-144
        4 Warp Energy ecard2-147
        1 Metal Energy ecard2-143
        `,
    'Charizard Venusaur': `
        3 Charmander ecard1-98
        3 Charmeleon ecard1-73
        3 Charizard ecard1-40
        3 Bulbasaur ecard1-95
        3 Ivysaur ecard1-82
        2 Venusaur ecard1-68
        2 Clefairy ecard1-101
        2 Clefable ecard1-41
        2 Porygon ecard2-103
        2 Porygon2 ecard2-28
        1 Lapras ecard3-71
        4 Pokémon Fan Club ecard2-130
        4 Professor Elm's Training Method ecard1-148
        3 Professor Oak's Research ecard1-149
        3 Underground Expedition ecard3-140
        2 Town Volunteers ecard2-136
        1 Copycat ecard1-138
        1 Desert Shaman ecard3-123
        1 Switch ecard1-157
        10 Fire Energy ecard1-161
        5 Grass Energy ecard1-162
        `,
    Beedrill: `
        2 Weedle ecard3-115
        2 Weedle ecard3-114
        4 Kakuna ecard3-70
        4 Beedrill ecard3-5
        2 Lapras ecard3-71
        2 Undersea Ruins ecard2-138
        4 Professor Oak's Research ecard1-149
        3 Professor Elm's Training Method ecard1-148
        3 Apricorn Maker ecard3-121
        3 Underground Expedition ecard3-140
        2 Copycat ecard1-138
        1 Desert Shaman ecard3-123
        1 Relic Hunter ecard3-120
        1 Town Volunteers ecard2-136
        4 Dual Ball ecard1-139
        4 Fast Ball ecard3-124
        3 Lure Ball ecard3-128
        11 Grass Energy ecard1-162
        4 Retro Energy ecard3-144
        `,
    Alakazam: `
        4 Abra ecard1-93
        4 Kadabra ecard1-84
        2 Alakazam ecard1-33
        2 Alakazam ecard3-2
        1 Moltres ecard3-21
        1 Articuno ecard3-4
        1 Zapdos ecard2-44
        1 Lapras ecard3-71
        1 Power Plant ecard2-139
        4 Pokémon Fan Club ecard2-130
        4 Professor Elm's Training Method ecard1-148
        4 Juggler ecard2-126
        3 Underground Expedition ecard3-140
        2 Fisherman ecard3-125
        1 Town Volunteers ecard2-136
        4 Energy Removal 2 ecard1-140
        2 Energy Search ecard1-153
        1 Hyper Potion ecard3-127
        5 Psychic Energy ecard1-164
        2 Fire Energy ecard1-161
        2 Water Energy ecard1-165
        2 Lightning Energy ecard1-163
        4 Rainbow Energy ecard2-144
        2 Bounce Energy ecard3-142
        1 Warp Energy ecard2-147
        `,
  },

  '2000-2002 Neo-On': {
    SMF: `
        3 Cleffa neo1-20
        3 Scyther ecard2-106
        2 Scizor ecard2-32
        2 Sentret ecard2-107
        2 Furret ecard2-48
        2 Grimer base6-78
        2 Muk base6-16
        2 Mantine neo4-74
        4 Gold Berry neo1-93
        2 Balloon Berry neo3-60
        4 Copycat ecard1-138
        4 Pokémon Fan Club ecard2-130
        1 Town Volunteers ecard2-136
        4 Professor Elm neo1-96
        4 Pokémon Trader base6-103
        3 Power Charge ecard1-147
        3 Double Gust neo1-100
        4 Metal Energy ecard2-143
        4 Rainbow Energy ecard2-144
        3 Water Energy ecard1-165
        2 Warp Energy ecard2-147
        `,
    'Meganium Exeggutor': `
        4 Cleffa neo1-20
        3 Pichu neo1-12
        3 Chikorita ecard1-99
        3 Bayleef ecard1-71
        3 Meganium neo1-11
        3 Exeggcute ecard2-76
        3 Exeggutor ecard2-12
        2 Energy Stadium neo4-99
        3 Focus Band neo1-86
        4 Copycat ecard1-138
        3 Pokémon Fan Club ecard2-130
        1 Town Volunteers ecard2-136
        4 Professor Elm neo1-96
        4 Pokémon Trader base6-103
        3 Double Gust neo1-100
        14 Grass Energy ecard1-162
        `,
    'Entei Cargo': `
        2 Cleffa neo1-20
        4 Entei neo3-6
        4 Slugma neo4-82
        4 Magcargo neo3-33
        3 Focus Band neo1-86
        4 Copycat ecard1-138
        3 Oracle ecard3-138
        2 Town Volunteers ecard2-136
        3 Professor Elm neo1-96
        3 Scoop Up base6-104
        3 Dual Ball ecard1-139
        3 Double Gust neo1-100
        2 Bill base6-108
        18 Fire Energy ecard1-161
        2 Metal Energy ecard2-143
        `,
  },

  '2000 Prop 15/3': {
    'Life Drain': `
        3 Sabrina's Abra gym2-93
        3 Sabrina's Kadabra gym2-58
        2 Sabrina's Alakazam gym2-16
        3 Sabrina's Venonat gym1-96
        3 Sabrina's Venomoth gym1-34
        3 Zubat base5-70
        3 Dark Golbat base5-24
        2 Sabrina's Jynx gym2-57
        1 Sabrina's Mr. Mime gym2-59
        1 Mewtwo basep-14
        3 Professor Oak base1-88
        3 Computer Search base1-71
        3 Pokémon Trader base1-77
        3 Sabrina's ESP gym1-117
        2 Super Energy Removal base1-79
        1 Gust of Wind base1-93
        8 Psychic Energy base1-101
        7 Grass Energy gym2-129
        3 Rainbow Energy base5-80
        3 Double Colorless Energy base1-96
        `,
    'Rain Dance': `
        3 Squirtle base1-63
        3 Wartortle base1-42
        3 Blastoise base1-2
        3 Magikarp base5-47
        3 Dark Gyarados base5-25
        3 Articuno base3-17
        2 Lapras base3-25
        3 Computer Search base1-71
        3 Pokémon Trader base1-77
        3 Computer Error basep-16
        3 Super Energy Removal base1-79
        2 Super Potion base1-90
        1 Professor Oak base1-88
        25 Water Energy base1-102
        `,
    'Gengar Brock’s Golbat': `
        3 Gastly base3-33
        3 Haunter base3-21
        3 Gengar base3-20
        3 Brock's Zubat gym1-24
        3 Brock's Golbat gym1-39
        3 Brock's Mankey gym1-67
        2 Mr. Mime base2-22
        2 Lickitung base2-38
        1 Kangaskhan base4-26
        1 The Rocket's Training Gym gym1-104
        3 Professor Oak base1-88
        3 Pokémon Trader base1-77
        3 Super Energy Removal base1-79
        2 Computer Search base1-71
        1 Gust of Wind base1-93
        1 Erika's Perfume gym1-110
        1 Item Finder base1-74
        14 Psychic Energy base1-101
        3 Double Colorless Energy base1-96
        3 Potion Energy base5-82
        2 Full Heal Energy base5-81
        `,
    'Dark Alakazam Dark Vileplume': `
        3 Abra base1-43
        3 Dark Kadabra base5-39
        3 Dark Alakazam base5-18
        3 Oddish base5-63
        3 Dark Gloom base5-36
        2 Dark Vileplume base5-13
        3 Chansey base1-3
        3 Mr. Mime base2-22
        2 Doduo base1-48
        2 Dodrio base2-34
        2 Resistance Gym gym2-109
        3 Computer Search base1-71
        3 Pokémon Trader base1-77
        3 Professor Oak base1-88
        3 The Boss's Way base5-73
        1 Pokémon Breeder base1-76
        15 Psychic Energy base1-101
        3 Double Colorless Energy base1-96
        `,
    'Blaine’s Rapidash Wigglytuff': `
        3 Blaine's Ponyta gym1-63
        3 Blaine's Rapidash gym2-33
        3 Jigglypuff base2-54
        3 Wigglytuff base2-32
        3 Magmar base3-39
        3 Kangaskhan base2-21
        2 Grimer base3-48
        2 Muk base3-28
        1 Scyther base2-26
        2 Chaos Gym gym2-102
        3 Computer Search base1-71
        3 Professor Oak base1-88
        3 Pokémon Trader base1-77
        2 Gust of Wind base1-93
        1 Super Energy Removal base1-79
        1 Scoop Up base1-78
        14 Fire Energy gym2-128
        3 Double Colorless Energy base1-96
        3 Full Heal Energy base5-81
        2 Potion Energy base5-82
        `,
  },

  '2000 Base-Gym': {
    'Wigglytuff Trapper': `
        3 Mankey base2-55
        3 Jigglypuff base2-54
        3 Wigglytuff base2-32
        2 Scyther base2-26
        1 Rattata base5-66
        1 Erika's Jigglypuff gym2-69
        1 No Removal Gym gym1-103
        1 Chaos Gym gym2-102
        4 Erika gym1-100
        4 Bill base1-91
        4 Rocket's Sneak Attack base5-72
        4 The Rocket's Trap gym1-19
        4 PlusPower base1-84
        4 Item Finder base1-74
        4 Computer Search base1-71
        3 Misty's Wrath gym1-114
        3 Imposter Oak's Revenge base5-76
        2 Professor Oak base1-88
        2 Energy Removal base1-92
        1 Nightly Garbage Run base5-77
        1 Grass Energy gym2-129
        4 Double Colorless Energy base1-96
        1 Full Heal Energy base5-81
        `,
    'Brock’s Ninetales Misty’s Gyarados': `
        4 Brock's Vulpix gym2-37
        3 Brock's Ninetales gym2-3
        3 Misty's Gyarados gym2-13
        1 Dark Blastoise base5-20
        1 Poliwrath base1-13
        4 Chansey base1-3
        2 Erika's Dratini gym1-42
        1 Narrow Gym gym1-124
        4 Professor Oak base1-88
        3 Computer Search base1-71
        3 Item Finder base1-74
        3 Brock's Protection gym2-101
        3 Energy Removal base1-92
        2 Super Energy Removal base1-79
        2 Potion base1-94
        2 Gust of Wind base1-93
        2 Nightly Garbage Run base5-77
        1 Lass base1-75
        1 Brock's Training Method gym1-106
        1 PlusPower base1-84
        12 Water Energy gym2-132
        2 Double Colorless Energy base1-96
        `,
    'Aerodactyl Erika’s Dratini': `
        4 Erika's Dratini gym1-42
        3 Mewtwo basep-14
        2 Chansey base1-3
        1 Mr. Mime base2-22
        1 Mew basep-8
        1 Ditto base3-18
        2 Aerodactyl base3-16
        1 Resistance Gym gym2-109
        1 Celadon City Gym gym1-107
        4 Mysterious Fossil base3-62
        4 Professor Oak base1-88
        3 Potion base1-94
        3 Computer Search base1-71
        3 Super Energy Removal base1-79
        3 Item Finder base1-74
        2 Gust of Wind base1-93
        2 Scoop Up base1-78
        2 Nightly Garbage Run base5-77
        1 Lass base1-75
        1 PlusPower base1-84
        10 Psychic Energy gym1-131
        4 Double Colorless Energy base1-96
        2 Potion Energy base5-82
        `,
  },
  '2000 Base–Team R': {
    Magmarbuzz: `
        4 Magmar base3-39
        3 Electabuzz base1-20
        3 Scyther base2-26
        2 Ditto base3-18
        4 Professor Oak base1-88
        4 Bill base1-91
        4 Energy Retrieval base1-81
        4 Energy Removal base1-92
        3 Super Energy Removal base1-79
        2 Gust of Wind base1-93
        2 PlusPower base1-84
        2 Scoop Up base1-78
        2 Item Finder base1-74
        2 Energy Search base1-59
        1 Nightly Garbage Run base5-77
        8 Fire Energy base1-98
        6 Lightning Energy base1-100
        4 Double Colorless Energy base1-96
        `,
    'Lickitung Moltres': `
        4 Lickitung base2-38
        3 Scyther base2-26
        2 Grimer base3-48
        2 Muk base3-28
        2 Magmar base3-39
        2 Moltres base3-27
        2 Chansey base1-3
        1 Mew basep-8
        4 Scoop Up base1-78
        4 Energy Retrieval base1-81
        4 Energy Removal base1-92
        3 Super Energy Removal base1-79
        3 Professor Oak base1-88
        3 Item Finder base1-74
        1 Pokémon Center base1-85
        1 Computer Search base1-71
        1 PlusPower base1-84
        1 Nightly Garbage Run base5-77
        11 Fire Energy base1-98
        2 Psychic Energy base1-101
        4 Double Colorless Energy base1-96
        `,
    'Dark Vileplume Snorlax': `
        4 Psyduck base3-53
        2 Dark Golduck base5-37
        4 Oddish base5-63
        3 Dark Gloom base5-36
        3 Dark Vileplume base5-13
        3 Snorlax base2-27
        2 Kangaskhan base2-21
        2 Mr. Mime base2-22
        4 Computer Search base1-71
        4 Bill base1-91
        4 Professor Oak base1-88
        2 Switch base1-95
        2 Pokémon Breeder base1-76
        2 The Boss's Way base5-73
        1 Gust of Wind base1-93
        9 Psychic Energy base1-101
        4 Double Colorless Energy base1-96
        3 Potion Energy base5-82
        2 Full Heal Energy base5-81
        `,
    'Buzzap Potpourri': `
        4 Voltorb base5-69
        4 Electrode base1-21
        2 Machop base5-59
        2 Machoke base1-34
        2 Chansey base1-3
        1 Ponyta base1-60
        1 Mewtwo basep-14
        1 Staryu base1-65
        4 Professor Oak base1-88
        4 Computer Search base1-71
        4 Bill base1-91
        4 Rocket's Sneak Attack base5-72
        4 PlusPower base1-84
        4 Item Finder base1-74
        2 Gust of Wind base1-93
        2 Pokémon Trader base1-77
        2 Maintenance base1-83
        2 Switch base1-95
        1 Energy Removal base1-92
        1 Imposter Oak's Revenge base5-76
        1 Goop Gas Attack base5-78
        1 Nightly Garbage Run base5-77
        4 Double Colorless Energy base1-96
        3 Rainbow Energy base5-80
        `,
    'Alakazam, Dark Vileplume, & Kangaskhan': `
        4 Abra base1-43
        3 Kadabra base1-32
        3 Alakazam base1-1
        4 Oddish base5-63
        3 Dark Gloom base5-36
        3 Dark Vileplume base5-13
        4 Kangaskhan base2-21
        3 Chansey base1-3
        1 Snorlax base2-27
        4 Computer Search base1-71
        4 Bill base1-91
        4 Professor Oak base1-88
        4 Pokémon Trader base1-77
        4 Pokémon Breeder base1-76
        1 Maintenance base1-83
        4 Double Colorless Energy base1-96
        4 Full Heal Energy base5-81
        3 Rainbow Energy base5-80
        `,
    'Mewtwo Electabuzz': `
        4 Scyther base2-26
        3 Mewtwo basep-14
        3 Electabuzz base1-20
        2 Chansey base1-3
        2 Ditto base3-18
        4 Professor Oak base1-88
        4 Computer Search base1-71
        3 Energy Removal base1-92
        3 Super Energy Removal base1-79
        3 Rocket's Sneak Attack base5-72
        3 Scoop Up base1-78
        3 Item Finder base1-74
        3 Nightly Garbage Run base5-77
        2 Gust of Wind base1-93
        2 PlusPower base1-84
        6 Psychic Energy base1-101
        6 Lightning Energy base1-100
        4 Double Colorless Energy base1-96
        `,
    'Hitmonchan Mewtwo': `
        3 Mewtwo basep-14
        3 Hitmonchan base1-7
        2 Lickitung base2-38
        2 Scyther base2-26
        2 Ditto base3-18
        1 Mew basep-8
        4 Professor Oak base1-88
        4 Bill base1-91
        3 Computer Search base1-71
        3 PlusPower base1-84
        3 Item Finder base1-74
        2 Energy Removal base1-92
        2 Super Energy Removal base1-79
        2 Gust of Wind base1-93
        2 Scoop Up base1-78
        2 Switch base1-95
        2 Nightly Garbage Run base5-77
        1 Lass base1-75
        7 Psychic Energy base1-101
        6 Fighting Energy base1-97
        4 Double Colorless Energy base1-96
        `,
  },

  '1999 Base-Fossil': {
    'Haymaker Deck': `
        Pokémon (10)
        4 Electabuzz base4-24
        4 Hitmonchan base4-8
        3 Farfetch'd base4-40
        
        Trainer (29)
        3 Bill base1-91
        3 Gust Of Wind base1-93
        4 PlusPower base1-84
        2 Computer Search base4-101
        3 Scoop Up base4-107
        3 Item Finder base1-74
        4 Energy Removal base4-119
        3 Energy Retrieval base1-81
        4 Professor Oak base1-88
        3 Super Energy Removal base1-79
        
        Energy (11)
        4 Double Colorless Energy base1-96
        7 Fighting Energy base1-97
        6 Lightning Energy base1-100`,
    'Alakazam, Mr. Mime, & Chansey': `
        Pokémon (21)
        4 Abra base1-43
        3 Kadabra base1-32
        3 Alakazam base1-1
        3 Kangaskhan base2-21
        2 Chansey base1-3
        2 Mr. Mime base2-22
        2 Scyther base2-26
        2 Psyduck base3-53

        Trainer (22)
        4 Energy Retrieval base1-81
        3 Item Finder base1-74
        3 Professor Oak base1-88
        3 Switch base1-95
        2 Pokémon Center base1-85
        2 Computer Search base1-71
        2 Pokémon Trader base1-77
        1 Gust of Wind base1-93
        1 Gambler base3-60
        1 Pokémon Breeder base1-76

        Energy (17)
        9 Psychic Energy base1-101
        4 Grass Energy base1-99
        4 Double Colorless Energy base1-96`,
    'Arcanine Electrode': `
        Pokémon (19)
        4 Psyduck base3-53
        4 Voltorb base1-67
        4 Electrode base1-21
        3 Growlithe base1-28
        3 Arcanine base1-23
        1 Gastly base3-33

        Trainer (31)
        4 Professor Oak base1-88
        4 Bill base1-91
        4 Computer Search base1-71
        4 Item Finder base1-74
        3 Lass base1-75
        2 Switch base1-95
        2 Pokémon Trader base1-77
        2 Maintenance base1-83
        2 Defender base1-80
        2 Energy Removal base1-92
        1 PlusPower base1-84
        1 Gust of Wind base1-93

        Energy (10)
        6 Psychic Energy base1-101
        4 Double Colorless Energy base1-96`,
    'Clefable, Hitmonchan, & Dodrio': `
        Pokémon (18)
        4 Doduo base1-48
        3 Dodrio base2-34
        3 Clefairy base1-5
        3 Clefable base2-17
        3 Hitmonchan base1-7
        2 Electabuzz basep-2

        Trainer (27)
        4 Professor Oak base1-88
        4 Bill base1-91
        4 Energy Removal base1-92
        3 Super Energy Removal base1-79
        2 Gust of Wind base1-93
        2 PlusPower base1-84
        2 Pokémon Center base1-85
        2 Pokémon Trader base1-77
        2 Item Finder base1-74
        1 Energy Retrieval base1-81
        1 Lass base1-75

        Energy (15)
        11 Fighting Energy base1-97
        4 Double Colorless Energy base1-96`,
    'Hitmonchan, Mewtwo, & Dodrio': `
        Pokémon (16)
        4 Doduo base1-48
        3 Dodrio base2-34
        4 Hitmonchan base1-7
        2 Mewtwo basep-3
        2 Mr. Mime base2-22
        1 Mew basep-8

        Trainer (28)
        4 Professor Oak base1-88
        4 Bill base1-91
        3 Energy Retrieval base1-81
        3 PlusPower base1-84
        3 Gust of Wind base1-93
        3 Energy Removal base1-92
        2 Super Energy Removal base1-79
        2 Item Finder base1-74
        1 Lass base1-75
        1 Pokémon Center base1-85
        1 Computer Search base1-71
        1 Mr. Fuji base3-58

        Energy (16)
        8 Psychic Energy base1-101
        7 Fighting Energy base1-97
        1 Double Colorless Energy base1-96`,
    'Dragonite, Dodrio, & Hitmonchan': `
        Pokémon (23)
        4 Dratini base1-26
        3 Dragonair base1-18
        3 Dragonite base3-19
        4 Kangaskhan base2-21
        3 Hitmonchan base1-7
        2 Doduo base1-48
        2 Dodrio base2-34
        1 Lickitung base2-38
        1 Mr. Mime base2-22

        Trainer (20)
        4 Bill base1-91
        4 Energy Retrieval base1-81
        3 Lass base1-75
        2 Professor Oak base1-88
        2 Pokémon Trader base1-77
        2 Item Finder base1-74
        1 PlusPower base1-84
        1 Gust of Wind base1-93
        1 Super Energy Removal base1-79

        Energy (17)
        9 Fighting Energy base1-97
        4 Psychic Energy base1-101
        4 Double Colorless Energy base1-96`,
    'Lickitung, Scyther, & Mr. Mime': `
        Pokémon (15)
        4 Lickitung base2-38
        3 Scyther base2-26
        2 Chansey base1-3
        2 Mr. Mime base2-22
        1 Mewtwo basep-3
        1 Gastly base3-33
        1 Ditto base3-18
        1 Psyduck base3-53

        Trainer (27)
        4 Scoop Up base1-78
        4 Professor Oak base1-88
        4 Energy Retrieval base1-81
        4 Item Finder base1-74
        4 Super Energy Removal base1-79
        3 Energy Removal base1-92
        1 PlusPower base1-84
        1 Gust of Wind base1-93
        1 Pokémon Center base1-85
        1 Mr. Fuji base3-58

        Energy (18)
        13 Psychic Energy base1-101
        1 Grass Energy base1-99
        4 Double Colorless Energy base1-96`,
    'Rain Dance': `
        Pokémon (12)
        4 Squirtle base1-63
        1 Wartortle base1-42
        3 Blastoise base1-2
        4 Articuno base3-17

        Trainer (34)
        4 Professor Oak base1-88
        4 Bill base1-91
        4 Computer Search base1-71
        4 Pokémon Breeder base1-76
        4 Energy Retrieval base1-81
        3 Item Finder base1-74
        2 Switch base1-95
        2 Super Energy Removal base1-79
        2 Maintenance base1-83
        2 Super Potion base1-90
        1 PlusPower base1-84
        1 Gust of Wind base1-93
        1 Lass base1-75

        Energy (14)
        14 Water Energy base1-102`,
    'Venusaur Dodrio': `
        Pokémon (17)
        4 Bulbasaur base1-44
        3 Ivysaur base1-30
        3 Venusaur base1-15
        4 Kangaskhan base2-21
        3 Doduo base1-48
        3 Dodrio base2-34
        1 Chansey base1-3

        Trainer (25)
        4 Energy Retrieval base1-81
        4 Bill base1-91
        2 Professor Oak base1-88
        2 Pokémon Center base1-85
        2 Pokémon Trader base1-77
        2 Item Finder base1-74
        1 Super Energy Removal base1-79
        1 Gust of Wind base1-93
        1 PlusPower base1-84
        1 Mr. Fuji base3-58
        1 Lass base1-75

        Energy (18)
        17 Grass Energy base1-99
        1 Double Colorless Energy base1-96`,
    'Wigglytuff, Magmar, & Dodrio': `
        Pokémon (18)
        4 Jigglypuff base2-54
        3 Wigglytuff base2-32
        4 Doduo base1-48
        3 Dodrio base2-34
        4 Magmar base3-39

        Trainer (25)
        4 Professor Oak base1-88
        4 Bill base1-91
        4 Energy Retrieval base1-81
        3 Energy Removal base1-92
        2 Super Energy Removal base1-79
        2 PlusPower base1-84
        2 Gust of Wind base1-93
        2 Item Finder base1-74
        1 Pokémon Trader base1-77
        1 Lass base1-75

        Energy (17)
        13 Fire Energy base1-98
        4 Double Colorless Energy base1-96`,
  },
};

const altDeckImportInput = document.getElementById('altDeckImportInput');
const deckImport = document.getElementById('deckImport');
const decklistsButton = document.getElementById('decklistsButton');
const decklistsContextMenu = document.getElementById('decklistsContextMenu');
const mainDeckImportInput = document.getElementById('mainDeckImportInput');

export const getRandomDeckList = () => {
  const years = Object.keys(decklistsByYear);
  const randomYear = years[Math.floor(Math.random() * years.length)];
  const decks = Object.keys(decklistsByYear[randomYear]);
  const randomDeck = decks[Math.floor(Math.random() * decks.length)];
  return decklistsByYear[randomYear][randomDeck];
};

export const showDecklistsContextMenu = () => {
  decklistsContextMenu.innerHTML = '';

  for (const year of Object.keys(decklistsByYear)) {
    const yearItem = document.createElement('div');
    yearItem.classList.add('decklists-context-menu-item');
    yearItem.textContent = year;

    const deckSubMenu = document.createElement('div');
    deckSubMenu.classList.add('decklists-context-menu-sub-menu');

    for (const deck of Object.keys(decklistsByYear[year])) {
      const deckItem = document.createElement('div');
      deckItem.classList.add('decklists-context-menu-item');
      deckItem.textContent = deck;
      deckItem.addEventListener('click', () => {
        const input =
          mainDeckImportInput.style.display !== 'none'
            ? mainDeckImportInput
            : altDeckImportInput;
        input.value = '';
        input.value = decklistsByYear[year][deck];
        decklistsContextMenu.style.display = 'none';
      });

      deckSubMenu.appendChild(deckItem);

      // Add event listener for mouseover to highlight/bold the item
      deckItem.addEventListener('mouseover', () => {
        deckItem.classList.add('decklist-highlight');
      });

      // Add event listener for mouseout to remove the highlight/bold
      deckItem.addEventListener('mouseout', () => {
        deckItem.classList.remove('decklist-highlight');
      });
    }

    yearItem.appendChild(deckSubMenu);
    decklistsContextMenu.appendChild(yearItem);

    // Add event listener for mouseover to show the submenu
    yearItem.addEventListener('mouseover', () => {
      deckSubMenu.style.display = 'block';
      yearItem.style.fontWeight = 'bold';
    });

    // Add event listener for mouseout to hide the submenu
    yearItem.addEventListener('mouseout', () => {
      deckSubMenu.style.display = 'none';
      yearItem.style.fontWeight = 'normal';
    });
  }

  const adjustment = deckImport.offsetHeight - decklistsButton.offsetTop;
  decklistsContextMenu.style.bottom = `${adjustment}px`;

  decklistsContextMenu.style.display = 'block';
  // Use mousedown event to hide the menu when clicking outside
  document.addEventListener('mousedown', hidedecklistsContextMenu);
};

// Function to hide the context menu
const hidedecklistsContextMenu = (event) => {
  if (!decklistsContextMenu.contains(event.target)) {
    decklistsContextMenu.style.display = 'none';
    document.removeEventListener('mousedown', hidedecklistsContextMenu);
  }
};
